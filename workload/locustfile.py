from locust import task, tag
import urllib.parse
import random
from harmony.common import BaseHarmonyUser

class HarmonyUatUser(BaseHarmonyUser):

    def _harmony_service_example_bbox_variable_reformat_single(self):
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
        self._sync_request(name, collection, variable, params, 1)


    def _random_num_granules_service_example(self):
        name = 'Harmony Service Example: Bbox, Variable, and reformat'
        collection = 'C1233800302-EEDTEST'
        variable = 'blue_var'
        numResults = random.randint(1, 100)
        params = {
            'subset': [
                'lat(20:85)',
                'lon(-140:40)'
            ],
            'maxResults': numResults,
            'outputCrs': 'EPSG:4326',
            'format': 'image/png',
            'forceAsync': 'true'
        }
        self._async_request(name, collection, variable, params, 0)

    def _harmony_service_example_bbox_variable_reformat_50_granules(self):
        name = '50 granules Harmony Service Example: Bbox, Variable, and reformat'
        collection = 'C1233800302-EEDTEST'
        variable = 'blue_var'
        params = {
            'subset': [
                'lat(20:80)',
                'lon(-140:0)'
            ],
            'outputCrs': 'EPSG:4326',
            'format': 'image/png',
            'maxResults': 50
        }
        self._async_request(name, collection, variable, params, 14)

    def _swot_repr_europe(self):
        name = 'SWOT Reprojection: Europe scale extent'
        collection = 'C1233860183-EEDTEST'
        variable = 'all'
        params = {
            'granuleId': 'G1233860486-EEDTEST',
            'outputCrs': '+proj=lcc +lat_1=43 +lat_2=62 +lat_0=30 +lon_0=10 +x_0=0 +y_0=0 +ellps=intl +units=m no_defs',
            'interpolation': 'near',
            'scaleExtent': '-7000000,1000000,8000000,8000000'
        }
        self._sync_request(name, collection, variable, params, 2)

    def _netcdf_to_zarr_48_granules(self):
        name = '48 granules NetCDF-to-Zarr'
        collection = 'harmony_example_l2'
        variable = 'all'
        params = {
            'format': 'application/x-zarr',
            'maxResults': '48'
        }
        self._async_request(name, collection, variable, params, 3)

    def _chain_swot_repr_europe_to_zarr(self):
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
        self._async_request(name, collection, variable, params, 4)

    def _netcdf_to_zarr_large_granule(self):
        name = 'NetCDF to Zarr single large granule'
        collection = 'C1238621141-POCLOUD'
        variable = 'all'
        params = {
            'format': 'application/x-zarr',
            'maxResults': '1',
        }
        self._async_request(name, collection, variable, params, 5)

    def _harmony_gdal_adapter(self) -> object:
        name = 'HARMONY GDAL ADAPTER'
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
        self._sync_request(name, collection, variable, params, 6)

    def _podaac_l2ss_sync_variable(self):
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
        self._sync_request(name, collection, variable, params, 7)

    def _var_subsetter(self):
        name = 'Variable subsetter'
        collection = 'C1234714698-EEDTEST'
        variable = urllib.parse.quote('/gt1l/land_segments/canopy/h_canopy', safe='')
        params = {
            'granuleid': 'G1238479514-EEDTEST'
        }
        self._sync_request(name, collection, variable, params, 8)

    def _podaac_l2ss_async_spatial_temporal_50_granules(self):
        name = '50 granules PODAAC L2SS Async Spatial and Temporal'
        collection = 'C1234724471-POCLOUD'
        variable = 'all'
        params = {
            'subset': [
                'lat(5.7:83)',
                'lon(-62.8:36.4)',
                'time("2019-06-22T00:00:00Z":"2019-06-22T23:59:59Z")'
            ],
            'maxResults': 50
        }
        self._async_request(name, collection, variable, params, 9)

    def _netcdf_to_zarr_single_granule(self):
        name='NetCDF to Zarr single granule'
        collection = 'C1234088182-EEDTEST'
        variable = 'all'
        params = {
            'maxResults': 1,
            'format': 'application/x-zarr'
        }
        self._async_request(name, collection, variable, params, 10)

    def _concise_two_granules(self):
        name='Two PODAAC Concise granules'
        collection = 'C1234208438-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 2,
            'concatenate': 'true'
        }
        self._async_request(name, collection, variable, params, 11)

    def _concise_50_granules(self):
        name='50 granules PODAAC Concise'
        collection = 'C1234208438-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 50,
            'concatenate': 'true'
        }
        self._async_request(name, collection, variable, params, 15)


    def _hoss_spatial_and_variable_subset(self):
        name='HOSS spatial and variable subset'
        collection = 'C1222931739-GHRC_CLOUD'
        variable = 'atmosphere_cloud_liquid_water_content'
        params = {
            'maxResults': 1,
            'subset': [
                'lat(-60:-30)',
                'lon(-120:-90)',
            ]
        }
        self._sync_request(name, collection, variable, params, 12)

    def _chain_l2ss_to_zarr(self):
        name='Chain L2SS to zarr'
        collection = 'C1234724470-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 1,
            'subset': [
                'lat(-45:45)',
                'lon(0:180)',
            ],
            'format': 'application/x-zarr'
        }
        self._async_request(name, collection, variable, params, 13)

    ############################################
    # Locust tasks
    ############################################
    @tag('harmony-service-example', 'sync', 'variable', 'bbox', 'reproject', 'png', 'demo')
    @task(50)
    def harmony_service_example_bbox_variable_reformat_single(self):
        self._harmony_service_example_bbox_variable_reformat_single()

    @tag('harmony-service-example', 'async', 'variable', 'bbox', 'reproject', 'png', 'demo')
    @task(2)
    def harmony_service_example_bbox_variable_reformat_50_granules(self):
        self._harmony_service_example_bbox_variable_reformat_50_granules()

    @tag('swot-repr', 'sync', 'reproject', 'netcdf4', 'demo')
    @task(50)
    def swot_repr_europe(self):
        self._swot_repr_europe()

    @tag('netcdf-to-zarr', 'async', 'zarr', 'demo')
    @task(2)
    def netcdf_to_zarr_48_granules(self):
        self._netcdf_to_zarr_48_granules()

    # Broken with current netcdf-to-zarr
    @tag('chain', 'async', 'zarr', 'reproject', 'chain')
    @task(50)
    def chain_swot_repr_europe_to_zarr(self):
        self._chain_swot_repr_europe_to_zarr()

    # Unable to download from ASF site in sandbox and SIT now
    @tag('harmony-gdal', 'sync', 'bbox', 'variable', 'temporal', 'hierarchical-variable', 'netcdf4', 'uat-only')
    @task(2)
    def harmony_gdal_adapter(self):
        self._harmony_gdal_adapter()

    @tag('var-subsetter', 'sync', 'variable', 'hierarchical-variable', 'netcdf4', 'demo')
    @task(50)
    def var_subsetter(self):
        self._var_subsetter()

    @tag('podaac-l2ss', 'bbox', 'sync', 'netcdf4', 'agu', 'variable', 'demo')
    @task(50)
    def podaac_l2ss_sync_variable(self):
        self._podaac_l2ss_sync_variable()

    @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4', 'temporal', 'agu', 'demo')
    @task(2)
    def podaac_l2ss_async_spatial_temporal_50_granules(self):
        self._podaac_l2ss_async_spatial_temporal_50_granules()

    @tag('netcdf-to-zarr', 'async', 'zarr', 'agu', 'demo')
    @task(50)
    def netcdf_to_zarr_single_granule(self):
        self._netcdf_to_zarr_single_granule()

    @tag('async', 'concise', 'demo')
    @task(25)
    def concise_two_granules(self):
        self._concise_two_granules()

    @tag('async', 'concise', 'demo')
    @task(2)
    def concise_50_granules(self):
        self._concise_50_granules()

    @tag('async', 'hoss', 'demo')
    @task(50)
    def hoss_spatial_and_variable_subset(self):
        self._hoss_spatial_and_variable_subset()

    @tag('async', 'chain', 'zarr', 'l2ss', 'demo')
    @task(50)
    def chain_l2ss_to_zarr(self):
        self._chain_l2ss_to_zarr()

    @tag('ml', 'random')
    @task(50)
    def random_num_granules_service_example(self):
        self._random_num_granules_service_example()

    ## Something broken with this granule
    # @task(1)
    #     self._netcdf_to_zarr_large_granule()

    # @tag('netcdf-to-zarr', 'async', 'zarr', 'memory', 'slow')
    # @task(1)
    # def netcdf_to_zarr_large_granule(self):
    #     self._netcdf_to_zarr_large_granule()

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

