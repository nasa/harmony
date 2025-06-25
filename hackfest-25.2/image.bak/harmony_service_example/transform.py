# CLI for adapting a Harmony operation to GDAL
#
# If you have harmony in a peer folder with this repo, then you can run the following for an
# example:
#    python3 -m harmony_service_example --harmony-action invoke --harmony-input \
#    "$(cat ../harmony/services/harmony/example/service-operation.json)"

import subprocess
import os
import re
import shutil
from tempfile import mkdtemp

from harmony_service_example.geo import clip_bbox
from harmony_service_lib import BaseHarmonyAdapter
from harmony_service_lib.util import generate_output_filename, download, HarmonyException, stage
from pystac import Asset

from osgeo import gdal

mime_to_gdal = {
    "image/tiff": "GTiff",
    "image/png": "PNG",
    "image/gif": "GIF"
}

mime_to_extension = {
    "image/tiff": "tif",
    "image/png": "png",
    "image/gif": "gif"
}

mime_to_options = {
    "image/tiff": ["-co", "COMPRESS=LZW"]
}


class ObjectView(dict):
    """
    Simple class to make a dict look like an object.

    Example
    --------
        >>> o = ObjectView({ "key": "value" })
        >>> o.key
        'value'
    """
    __getattr__ = dict.get


class HarmonyAdapter(BaseHarmonyAdapter):
    """
    See See https://github.com/nasa/harmony-service-lib-py
    for documentation and examples.
    """

    def process_item(self, item, source):
        """
        Converts an input STAC Item's data into Zarr, returning an output STAC item

        Parameters
        ----------
        item : pystac.Item
            the item that should be converted
        source : harmony.message.Source
            the input source defining the variables, if any, to subset from the item

        Returns
        -------
        pystac.Item
            a STAC item containing the Zarr output
        """
        logger = self.logger
        message = self.message
        if message.subset and message.subset.shape:
            logger.warn('Ignoring subset request for user shapefile %s' %
                        (message.subset.shape.href,))

        layernames = []

        operations = dict(
            variable_subset=source.variables,
            is_regridded=bool(message.format.srs),
            is_subsetted=bool(message.subset and message.subset.bbox)
        )

        result = item.clone()
        result.assets = {}

        # Create a temporary dir for processing we may do
        output_dir = mkdtemp()
        try:
            # Get the data file
            asset = next(v for k, v in item.assets.items() if 'data' in (v.roles or []))
            input_filename = download(asset.href, output_dir, logger=self.logger,
                                      access_token=self.message.accessToken)

            basename = os.path.basename(generate_output_filename(asset.href, **operations))

            variables = source.variables or self.get_variables(input_filename)
            is_geotiff = self.is_geotiff(input_filename)

            for variable in variables:
                band = None
                if is_geotiff:
                    # For geotiffs, we can't reference variables by name but need to reference
                    # by raster band instead
                    index = next(i for i, v in enumerate(variables) if v.name == variable.name)
                    if index is None:
                        raise HarmonyException('Band not found: ' + variable)
                    band = index + 1
                    filename = input_filename
                else:
                    # For non-geotiffs, we reference variables by appending a file path
                    layer_format = self.read_layer_format(
                        source.collection,
                        input_filename,
                        variable.name
                    )
                    filename = layer_format.format(input_filename)

                layer_id = basename + '__' + variable.name
                filename = self.as_geotiff(
                    layer_id,
                    filename,
                    output_dir,
                    band
                )
                filename = self.subset(
                    layer_id,
                    filename,
                    output_dir
                )
                filename = self.reproject(
                    layer_id,
                    filename,
                    output_dir
                )
                filename = self.resize(
                    layer_id,
                    filename,
                    output_dir
                )
                filename = self.add_to_result(
                    layer_id,
                    filename,
                    output_dir
                )
                layernames.append(layer_id)

            self.update_layernames(filename, [v.name for v in variables])
            filename = self.reformat(filename, output_dir)

            output_filename = basename + os.path.splitext(filename)[-1]
            mime = message.format.mime
            url = stage(filename, output_filename, mime,
                        location=message.stagingLocation, logger=logger)

            # Update the STAC record
            result.assets['data'] = Asset(url, title=output_filename,
                                          media_type=mime, roles=['data'])

            # Return the STAC record
            return result
        finally:
            # Clean up any intermediate resources
            shutil.rmtree(output_dir)

    def update_layernames(self, filename, layernames):
        """
        Updates the layers in the given file to match the list of layernames provided

        Parameters
        ----------
        filename : string
            The path to file whose layernames should be updated
        layernames : string[]
            An array of names, in order, to apply to the layers
        """
        ds = gdal.Open(filename)
        for i in range(len(layernames)):
            ds.GetRasterBand(i + 1).SetDescription(layernames[i])
        ds = None

    def prepare_output_dir(self, output_dir):
        """
        Deletes (if present) and recreates the given output_dir, ensuring it exists
        and is empty

        Parameters
        ----------
        output_dir : string
            the directory to delete and recreate
        """
        self.cmd('rm', '-rf', output_dir)
        self.cmd('mkdir', '-p', output_dir)

    def cmd(self, *args):
        self.logger.info(args[0] + " " + " ".join(["'{}'".format(arg) for arg in args[1:]]))
        result_str = subprocess.check_output(args).decode("utf-8")
        return result_str.split("\n")

    def as_geotiff(self, layerid, srcfile, dstdir, band=None):
        normalized_layerid = layerid.replace('/', '_')
        command = ['gdal_translate', '-of', 'GTiff']
        if band is not None:
            command.extend(['-b', '%s' % (band)])
        dstfile = "%s/%s" % (dstdir, normalized_layerid + '__converted.tif')
        command.extend([srcfile, dstfile])

        self.cmd(*command)

        return dstfile

    def subset(self, layerid, srcfile, dstdir):
        normalized_layerid = layerid.replace('/', '_')
        subset = self.message.subset
        if not subset or not subset.bbox:
            return srcfile

        command = ['gdal_translate', '-of', 'GTiff']
        dataset_bounds = self._dataset_bounds(srcfile)
        bboxes = clip_bbox(dataset_bounds, subset.process('bbox'))

        # We should always have some intersection
        assert len(bboxes) > 0

        dstfiles = []
        for i, bbox in enumerate(bboxes):
            dstfile = "%s/%s" % (dstdir, normalized_layerid + f"__{i}_subsetted.tif")
            dstfiles.append(dstfile)
            bbox = [str(c) for c in bbox]
            command = command + ["-projwin", bbox[0], bbox[3], bbox[2], bbox[1], srcfile, dstfile]
            self.cmd(*command)

        if len(dstfiles) == 1:
            return dstfiles[0]
        else:
            dstfile = "%s/%s" % (dstdir, normalized_layerid + '__subsetted.tif')
            self.cmd('gdal_merge.py',
                     '-o', dstfile,
                     '-of', "GTiff",
                     *dstfiles)
            return dstfile

    def _dataset_bounds(self, srcfile):
        ds = gdal.Open(srcfile)
        x = ds.RasterXSize
        y = ds.RasterYSize
        gt = ds.GetGeoTransform()

        x_range = [gt[0], gt[0] + x * gt[1] + y * gt[2]]
        y_range = [gt[3], gt[3] + x * gt[4] + y * gt[5]]

        # Apparently the geo transform's pixel size can be negative, so
        # sometimes we have to reverse the range. Why?
        if gt[2] < 0:
            x_range.reverse()
        if gt[5] < 0:
            y_range.reverse()

        return (x_range, y_range)

    def reproject(self, layerid, srcfile, dstdir):
        srs = self.message.format.process('srs')
        if not (srs and srs.proj4):
            return srcfile
        normalized_layerid = layerid.replace('/', '_')
        dstfile = "%s/%s" % (dstdir, normalized_layerid + '__reprojected.tif')
        self.cmd('gdalwarp',
                 "-t_srs",
                 srs.proj4,
                 srcfile,
                 dstfile)
        return dstfile

    def resize(self, layerid, srcfile, dstdir):
        command = ['gdal_translate']

        fmt = self.message.format

        normalized_layerid = layerid.replace('/', '_')
        dstfile = "%s/%s__resized.tif" % (dstdir, normalized_layerid)

        if fmt.width or fmt.height:
            width = fmt.process('width') or 0
            height = fmt.process('height') or 0
            command.extend(["-outsize", str(width), str(height)])

        command.extend([srcfile, dstfile])

        self.cmd(*command)
        return dstfile

    def add_to_result(self, layerid, srcfile, dstdir):
        tmpfile = "%s/tmp-result.tif" % (dstdir)
        dstfile = "%s/result.tif" % (dstdir)

        command = ['gdal_merge.py',
                   '-o', tmpfile,
                   '-of', "GTiff",
                   '-separate']
        command.extend(mime_to_options["image/tiff"])

        if not os.path.exists(dstfile):
            self.cmd('cp', srcfile, dstfile)
            return dstfile

        command.extend([dstfile, srcfile])

        self.cmd(*command)
        self.cmd('mv', tmpfile, dstfile)

        return dstfile

    def reformat(self, srcfile, dstdir):
        output_mime = self.message.format.mime
        if output_mime not in mime_to_gdal:
            raise Exception('Unrecognized output format: ' + output_mime)
        self.message.format.process('mime')
        if output_mime == "image/tiff":
            return srcfile

        dstfile = "%s/translated.%s" % (dstdir, mime_to_extension[output_mime])

        command = ['gdal_translate',
                   '-of', mime_to_gdal[output_mime],
                   '-scale',
                   srcfile, dstfile]
        self.cmd(*command)

        return dstfile

    def read_layer_format(self, collection, filename, layer_id):
        gdalinfo_lines = self.cmd("gdalinfo", filename)
        layer_line = next(
            filter((lambda line: line.endswith(":" + layer_id)), gdalinfo_lines), None)
        if layer_line is None:
            print('Invalid Layer:', layer_id)

        layer = layer_line.split("=")[-1]
        return layer.replace(filename, "{}")

    def get_variables(self, filename):
        gdalinfo_lines = self.cmd("gdalinfo", filename)
        result = []
        # Normal case of NetCDF / HDF, where variables are subdatasets
        for subdataset in filter((lambda line: re.match(r"^\s*SUBDATASET_\d+_NAME=", line)),
                                 gdalinfo_lines):
            result.append(ObjectView({"name": re.split(r":", subdataset)[-1]}))
        if len(result) > 0:
            return result

        # GeoTIFFs, where variables are bands, with descriptions set to their variable name
        for subdataset in filter((lambda line: re.match(r"^\s*Description = ", line)),
                                 gdalinfo_lines):
            result.append(ObjectView({"name": re.split(r" = ", subdataset)[-1]}))
        return result

    def is_geotiff(self, filename):
        gdalinfo_lines = self.cmd("gdalinfo", filename)
        return gdalinfo_lines[0] == "Driver: GTiff/GeoTIFF"
