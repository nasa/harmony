from locust import task, tag
import urllib.parse
from harmony.common import BaseHarmonyUser


class ProdHarmonyUser(BaseHarmonyUser):
    @tag('harmony-service-example', 'sync', 'bbox', 'reproject', 'png')
    @task(2)
    def harmony_service_example_bbox_variable_reformat(self):
        collection = 'C1756916832-XYZ_PROV'
        variable = 'all'
        params = {
            'subset': [
                'lat(20:60)',
                'lon(-140:-50)'
            ],
            'granuleId': 'G1756917329-XYZ_PROV',
            'outputCrs': 'EPSG:4326',
            'format': 'image/png'
        }

        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name='Harmony Service Example: Bbox, reproject, and reformat')

    @tag('podaac-l2ss', 'bbox', 'sync', 'netcdf4')
    @task(5)
    def podaac_l2ss_sync(self):
        collection = 'C1940473819-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 1,
            'subset': [
                'lon(-160:160)',
                'lat(-80:80)'
            ]
        }
        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='PODAAC L2SS'
        )

    @tag('asf-gdal', 'sync', 'bbox', 'variable', 'hierarchical-variable', 'netcdf4')
    @task(2)
    def harmony_gdal_adapter(self):
        collection = 'C1595422627-ASF'
        variable = urllib.parse.quote('science/grids/data/amplitude', safe='')
        params = {
            'maxResults': 1,
            'subset': [
                'lon(-70:-69)',
                'lat(-38:-37)'
            ]
        }
        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='HARMONY GDAL ADAPTER'
        )

    @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4')
    @task(2)
    def podaac_l2ss_async(self):
        collection = 'C1940473819-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 2,
            'subset': [
                'lon(-160:160)',
                'lat(-80:80)'
            ]
        }
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='PODAAC L2SS Async'
        )
        self.wait_for_job_completion(response)

    @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4', 'temporal', 'agu')
    @task(1)
    def podaac_l2ss_async_spatial_temporal(self):
        collection = 'C1940475563-POCLOUD'
        variable = 'all'
        params = {
            'subset': [
                'lat(81.7:83)',
                'lon(-62.8:-56.4)',
                'time("2019-06-22T00:00:00Z":"2019-06-22T23:59:59Z")'
            ]
        }
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='PODAAC L2SS Async Spatial and Temporal'
        )
        self.wait_for_job_completion(response)

    @tag('netcdf-to-zarr', 'async', 'zarr', 'agu')
    @task(1)
    def netcdf_to_zarr_single_granule(self):
        collection = 'C1938032626-POCLOUD'
        variable = 'all'
        params = {
            'maxResults': 1
        }
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='NetCDF to Zarr single granule'
        )
        self.wait_for_job_completion(response)

    @tag('netcdf-to-zarr', 'async', 'zarr', 'agu', 'temporal')
    @task(1)
    def netcdf_to_zarr_temporal(self):
        collection = 'C1940468263-POCLOUD'
        variable = 'all'
        params = {
            'subset': [
              'time("2020-01-01T00:00:00.000Z":"2020-01-02T00:00:00.000Z")'
            ]
        }
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='NetCDF to Zarr temporal subset'
        )
        self.wait_for_job_completion(response)
