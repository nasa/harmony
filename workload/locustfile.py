from locust import task, tag
import urllib.parse
from harmony.common import BaseHarmonyUser

class HarmonyUatUser(BaseHarmonyUser):

    def _harmony_service_example_bbox_variable_reformat(self, turbo=False):
        name = 'Harmony Service Example: Bbox, Variable, and reformat'
        collection = 'C1233800302-EEDTEST'
        variable = 'blue_var'
        params = {
            'subset': [
                'lat(20:60)',
                'lon(-140:-50)'
            ],
            'granuleId': 'G1233800343-EEDTEST',
            'outputCrs': 'EPSG:4326',
            'format': 'image/png'
        }
        self._sync_request(name, collection, variable, params, turbo, 1)

    def _swot_repr_europe(self, turbo=False):
        name = 'SWOT Reprojection: Europe scale extent'
        collection = 'C1233860183-EEDTEST'
        variable = 'all'
        params = {
            'granuleId': 'G1233860486-EEDTEST',
            'outputCrs': '+proj=lcc +lat_1=43 +lat_2=62 +lat_0=30 +lon_0=10 +x_0=0 +y_0=0 +ellps=intl +units=m no_defs',
            'interpolation': 'near',
            'scaleExtent': '-7000000,1000000,8000000,8000000'
        }
        self._sync_request(name, collection, variable, params, turbo, 2)

    def _netcdf_to_zarr_10_granules(self, turbo=False):
        name = 'NetCDF-to-Zarr: 10 granules'
        collection = 'harmony_example_l2'
        variable = 'all'
        params = {
            'format': 'application/x-zarr',
            'maxResults': '10'
        }
        self._async_request(name, collection, variable, params, turbo, 3)

    def _chain_swot_repr_europe_to_zarr(self, turbo=False):
        name = 'Chain SWOT Reprojection to NetCDF-to-Zarr'
        collection = 'harmony_example_l2'
        variable = 'all'
        params = {
            'maxResults': '1',
            'outputCrs': '+proj=lcc +lat_1=43 +lat_2=62 +lat_0=30 +lon_0=10 +x_0=0 +y_0=0 +ellps=intl +units=m no_defs',
            'interpolation': 'near',
            'scaleExtent': '-7000000,1000000,8000000,8000000',
            'format': 'application/x-zarr'
        }
        self._async_request(name, collection, variable, params, turbo, 4)

    def _netcdf_to_zarr_large_granule(self, turbo=False):
        name = 'NetCDF to Zarr single large granule'
        collection = 'C1238621141-POCLOUD'
        variable = 'all'
        params = {
            'format': 'application/x-zarr',
            'maxResults': '1',
        }
        self._async_request(name, collection, variable, params, turbo, 5)

    def _asf_gdal(self, turbo=False):
        name = 'ASF GDAL'
        collection = 'C1225776654-ASF'
        variable = urllib.parse.quote('science/grids/data/amplitude', safe='')
        params = {
            'granuleId': 'G1235282694-ASF',
            'subset': [
                'lon(37:40)',
                'lat(23:24)',
                'time("2014-10-30T15:00:00Z":"2014-10-30T15:59:00Z")'
            ]
        }
        self._sync_request(name, collection, variable, params, turbo, 6)

    def _podaac_l2ss_sync_variable(self, turbo=False):
        name = 'PODAAC L2SS mean sea surface'
        collection = 'C1234208438-POCLOUD'
        variable = 'mean_sea_surface'
        params = {
            'maxResults': 1,
            'subset': [
                'lon(-160:160)',
                'lat(-80:80)'
            ]
        }
        self._sync_request(name, collection, variable, params, turbo, 7)

    def _var_subsetter(self, turbo=False):
        name = 'Variable subsetter'
        collection = 'C1234714698-EEDTEST'
        variable = urllib.parse.quote('/gt1l/land_segments/canopy/h_canopy', safe='')
        params = {
            'granuleid': 'G1238479514-EEDTEST'
        }
        self._sync_request(name, collection, variable, params, turbo, 8)

    def _podaac_l2ss_async_spatial_temporal(self, turbo=False):
        name = 'PODAAC L2SS Async Spatial and Temporal'
        collection = 'C1234724471-POCLOUD'
        variable = 'all'
        params = {
            'subset': [
                'lat(81.7:83)',
                'lon(-62.8:-56.4)',
                'time("2019-06-22T00:00:00Z":"2019-06-22T23:59:59Z")'
            ]
        }
        self._async_request(name, collection, variable, params, turbo, 9)

    def _netcdf_to_zarr_single_granule(self, turbo=False):
        name='NetCDF to Zarr single granule'
        collection = 'C1234082763-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 1
        }
        self._async_request(name, collection, variable, params, turbo, 10)

    ############################################
    # Locust tasks
    ############################################
    @tag('harmony-service-example', 'sync', 'variable', 'bbox', 'reproject', 'png', 'argo')
    @task(2)
    def harmony_service_example_bbox_variable_reformat_argo(self):
        self._harmony_service_example_bbox_variable_reformat(False)

    @tag('harmony-service-example', 'sync', 'variable', 'bbox', 'reproject', 'png', 'turbo')
    @task(2)
    def harmony_service_example_bbox_variable_reformat_turbo(self):
        self._harmony_service_example_bbox_variable_reformat(True)

    @tag('swot-repr', 'sync', 'reproject', 'netcdf4', 'argo')
    @task(2)
    def swot_repr_europe_argo(self):
        self._swot_repr_europe()

    @tag('swot-repr', 'sync', 'reproject', 'netcdf4', 'turbo')
    @task(2)
    def swot_repr_europe_turbo(self):
        self._swot_repr_europe(True)

    @tag('netcdf-to-zarr', 'async', 'zarr', 'argo')
    @task(2)
    def netcdf_to_zarr_10_granules_argo(self):
        self._netcdf_to_zarr_10_granules()

    @tag('netcdf-to-zarr', 'async', 'zarr', 'turbo')
    @task(2)
    def netcdf_to_zarr_10_granules_turbo(self):
        self._netcdf_to_zarr_10_granules(True)

    @tag('chain', 'async', 'zarr', 'reproject', 'argo', 'chain')
    @task(2)
    def chain_swot_repr_europe_to_zarr_argo(self):
        self._chain_swot_repr_europe_to_zarr()

    @tag('chain', 'async', 'zarr', 'reproject', 'turbo', 'chain')
    @task(2)
    def chain_swot_repr_europe_to_zarr_turbo(self):
        self._chain_swot_repr_europe_to_zarr(True)

    # Unable to download from ASF site in sandbox and SIT now
    @tag('asf-gdal', 'sync', 'bbox', 'variable', 'temporal', 'hierarchical-variable', 'netcdf4', 'uat-only', 'argo')
    @task(2)
    def asf_gdal_argo(self):
        self._asf_gdal()

    # Unable to download from ASF site in sandbox and SIT now
    @tag('asf-gdal', 'sync', 'bbox', 'variable', 'temporal', 'hierarchical-variable', 'netcdf4', 'uat-only', 'turbo')
    @task(2)
    def asf_gdal_argo(self):
        self._asf_gdal(True)

    @tag('var-subsetter', 'sync', 'variable', 'hierarchical-variable', 'netcdf4', 'argo')
    @task(2)
    def var_subsetter_argo(self):
        self._var_subsetter()

    # Service does not support turbo yet
    # @tag('var-subsetter', 'sync', 'variable', 'hierarchical-variable', 'netcdf4', 'turbo')
    # @task(2)
    # def var_subsetter_turbo(self):
    #     self._var_subsetter(True)

    @tag('podaac-l2ss', 'bbox', 'sync', 'netcdf4', 'agu', 'variable', 'argo')
    @task(2)
    def podaac_l2ss_sync_variable_argo(self):
        self._podaac_l2ss_sync_variable()

    # Service does not support turbo yet
    # @tag('podaac-l2ss', 'bbox', 'sync', 'netcdf4', 'agu', 'variable', 'turbo')
    # @task(2)
    # def podaac_l2ss_sync_variable_turbo(self):
    #     self._podaac_l2ss_sync_variable(True)

    @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4', 'temporal', 'agu', 'argo')
    @task(2)
    def podaac_l2ss_async_spatial_temporal_argo(self):
        self._podaac_l2ss_async_spatial_temporal()

    # Service does not support turbo yet
    # @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4', 'temporal', 'agu', 'turbo')
    # @task(2)
    # def podaac_l2ss_async_spatial_temporal_turbo(self):
    #     self._podaac_l2ss_async_spatial_temporal(True)

    @tag('netcdf-to-zarr', 'async', 'zarr', 'agu', 'argo')
    @task(2)
    def netcdf_to_zarr_single_granule_argo(self):
        self._netcdf_to_zarr_single_granule()

    @tag('netcdf-to-zarr', 'async', 'zarr', 'agu', 'turbo')
    @task(2)
    def netcdf_to_zarr_single_granule_turbo(self):
        self._netcdf_to_zarr_single_granule(True)

    @tag('netcdf-to-zarr', 'async', 'zarr', 'argo', 'memory', 'slow')
    @task(1)
    def netcdf_to_zarr_large_granule_argo(self):
        self._netcdf_to_zarr_large_granule()

    @tag('netcdf-to-zarr', 'async', 'zarr', 'turbo', 'memory', 'slow')
    @task(1)
    def netcdf_to_zarr_large_granule_turbo(self):
        self._netcdf_to_zarr_large_granule(True)

    ## Shapefile request is currently not working
    # @tag('podaac-ps3', 'shapefile', 'sync', 'temporal', 'netcdf4')
    # @task(2)
    # def podaac_shapefile(self):
    #     collection = 'C1234530533-EEDTEST'
    #     variable = 'all'
    #     shapefile_location = '../docs/notebook_helpers/test_in-polygon.shp.zip'
    #     self.client.post(
    #         self.coverages_root.format(
    #             collection=collection,
    #             variable=variable
    #         ),
    #         data={'subset': 'time("2009-01-09T00:00:00Z":"2009-01-09T01:00:00Z")'},
    #         files={'shapefile': ('test_in-polygon.shp.zip',
    #                              open(shapefile_location, 'rb'), 'application/shapefile+zip')},
    #         name='PODAAC Shapefile Subsetter')

