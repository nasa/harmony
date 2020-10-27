import time
from locust import HttpUser, task, tag, between
import urllib.parse

class QuickstartUser(HttpUser):
    wait_time = between(1, 2)
    coverages_root='/{collection}/ogc-api-coverages/1.0.0/collections/{variable}/coverage/rangeset'

    def on_start(self):
        self.client.trust_env = True

    @tag('cloud-access')
    @task
    def cloud_keys(self):
        self.client.get('/cloud-access', name='cloud access')

    @tag('landing-page')
    @task
    def landing_page(self):
        self.client.get('/', name='landing page')

    @tag('harmony-gdal', 'sync', 'variable', 'bbox', 'reproject', 'png')
    @task(2)
    def harmony_gdal_bbox_variable_reformat(self):
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

        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name='Harmony GDAL: Bbox, Variable, and reformat')

    @tag('swot-repr', 'sync', 'reproject', 'netcdf4')
    @task(2)
    def swot_repr_europe(self):
        collection = 'C1233860183-EEDTEST'
        variable = 'all'
        params = {
            'granuleId': 'G1233860486-EEDTEST',
            'outputCrs': '+proj=lcc +lat_1=43 +lat_2=62 +lat_0=30 +lon_0=10 +x_0=0 +y_0=0 +ellps=intl +units=m no_defs',
            'interpolation': 'near',
            'scaleExtent': '-7000000,1000000,8000000,8000000'
        }

        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name='SWOT Reprojection: Europe scale extent')

    @tag('podaac-ps3', 'shapefile', 'sync', 'temporal', 'netcdf4')
    @task(2)
    def podaac_shapefile(self):
        collection = 'C1234530533-EEDTEST'
        variable = 'all'
        shapefile_location = '../docs/notebook_helpers/test_in-polygon.shp.zip'
        self.client.post(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            data={ 'subset': 'time("2009-01-09T00:00:00Z":"2009-01-09T01:00:00Z")' },
            files={ 'shapefile': ('test_in-polygon.shp.zip', open(shapefile_location, 'rb'), 'application/shapefile+zip') },
            name='PODAAC Shapefile Subsetter')

    @tag('podaac-l2ss', 'bbox', 'sync', 'netcdf4')
    @task(5)
    def podaac_l2ss_sync(self):
        collection = 'C1234208436-POCLOUD'
        variable = 'all'
        params = {
            'granuleid': 'G1237282385-POCLOUD',
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

    @tag('asf-gdal', 'sync', 'bbox', 'variable', 'temporal', 'hierarchical-variable', 'netcdf4')
    @task(2)
    def asf_gdal(self):
        collection = 'C1225776654-ASF'
        variable = urllib.parse.quote('science/grids/data/amplitude', safe='')
        params = {
            'granuleId' : 'G1235282694-ASF',
            'subset': [
                'lon(37:40)',
                'lat(23:24)',
                'time("2014-10-30T15:00:00Z":"2014-10-30T15:59:00Z")'
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

    @tag('var-subsetter', 'sync', 'variable', 'hierarchical-variable', 'netcdf4')
    @task(2)
    def var_subsetter(self):
        collection = 'C1234714698-EEDTEST'
        variable = urllib.parse.quote('/gt1l/land_segments/canopy/h_canopy', safe='')
        params = {
            'granuleid': 'G1238479514-EEDTEST'
        }
        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable
            ),
            params=params,
            name='Variable subsetter'
        )

    @tag('podaac-l2ss', 'bbox', 'async', 'netcdf4')
    @task(5)
    def podaac_l2ss_async(self):
        collection = 'C1234208436-POCLOUD'
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

    def wait_for_job_completion(self, response):
        """
        Polls and waits for an async job to complete.

        Arguments:
            response {response.Response} -- the initial job status response
        """
        body = response.json()
        while body['status'] not in ['successful', 'failed', 'canceled']:
            time.sleep(1)
            response = self.client.get(response.url)
            body = response.json()
        status = body['status']
        assert(status not in ['failed', 'canceled'])
        return status