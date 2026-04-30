// The mapping needs to include every mime-type we support as an output format in
// services.yml and the mapping to name needs to match the correct name in the
// enumeration for supported file formats in UMM-S
export const harmonyMimeTypeToName = {
  'application/netcdf': 'NETCDF-4',
  'application/x-hdf': 'HDF-EOS2',
  'application/x-netcdf4;profile=opendap_url': 'NETCDF-4 (OPeNDAP URL)',
  'application/x-zarr': 'ZARR',
  'image/gif': 'GIF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'GEOTIFF',
  'text/csv': 'CSV',
};

export const mimeTypeAliases = {
  'application/netcdf4': 'application/netcdf',
  'application/x-netcdf': 'application/netcdf',
  'application/x-netcdf4': 'application/netcdf',
};
