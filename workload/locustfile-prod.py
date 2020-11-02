from locust import task, tag
import urllib.parse
from harmony.common import BaseHarmonyUser


class ProdHarmonyUser(BaseHarmonyUser):
    @tag('harmony-gdal', 'sync', 'bbox', 'reproject', 'png')
    @task(2)
    def harmony_gdal_bbox_variable_reformat(self):
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
            name='Harmony GDAL: Bbox, reproject, and reformat')

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
    def asf_gdal(self):
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
            name='ASF GDAL'
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
