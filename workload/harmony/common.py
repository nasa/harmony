import time
from locust import HttpUser, task, tag, between
import requests

session_cookies = None

class BaseHarmonyUser(HttpUser):
    abstract = True
    wait_time = between(5, 20)
    coverages_root = '/{collection}/ogc-api-coverages/1.0.0/collections/{variable}/coverage/rangeset'

    def on_start(self):
        global session_cookies
        self.client.trust_env = True
        if session_cookies is None:
            self.client.get('/cloud-access', name='cloud access')
            session_cookies = self.client.cookies
        else:
            self.client.cookies = session_cookies

    @tag('cloud-access')
    @task
    def cloud_keys(self):
        self.client.get('/cloud-access', name='cloud access')

    @tag('landing-page')
    @task
    def landing_page(self):
        self.client.get('/', name='landing page')

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
