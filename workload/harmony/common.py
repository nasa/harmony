from time import time, sleep
from locust import HttpUser, task, tag, between, events
import logging
import os

session_cookies = None

class BaseHarmonyUser(HttpUser):
    abstract = True
    wait_time = between(1, 2)
    coverages_root = '/{collection}/ogc-api-coverages/1.0.0/collections/{variable}/coverage/rangeset'

    def on_start(self):
        self.client.trust_env = True
        bearer_token = os.getenv('WORKLOAD_BEARER_TOKEN')
        if bearer_token:
            # Set the Authorization header with the Bearer token
            self.client.headers.update({'Authorization': f'Bearer {bearer_token}'})
        else:
            raise EnvironmentError('WORKLOAD_BEARER_TOKEN environment variable is not set')

    @tag('cloud-access')
    @task
    def cloud_keys(self):
        self.client.get('/cloud-access', name='cloud access')

    @tag('landing-page')
    @task
    def landing_page(self):
        self.client.get('/', name='landing page')

    def wait_for_job_completion(self, response, name, start_time):
        """
        Polls and waits for an async job to complete.

        Arguments:
            response {response.Response} -- the initial job status response
            name {String}                -- the name of the request to display in the UI
            start_time {Timestamp}       -- the time the request was submitted
        """
        status = response.json()['status']
        try:
            while status not in ['successful', 'failed', 'canceled']:
                sleep(1)
                try:
                    response = self.client.get(response.url, name='job status')
                    status = response.json()['status']
                except Exception as e:
                    logging.warn('Job status endpoint error %s: %s', response, response.body)

            assert(status not in ['failed', 'canceled'])
            events.request.fire(
                context=self.context,
                request_type='async_job',
                name=name,
                response_time=(time() - start_time) * 1000,
                response_length=0,
                exception=None,
            )
        except Exception as e:
            events.request.fire(
                context=self.context,
                request_type='async_job',
                name=name,
                response_time=(time() - start_time) * 1000,
                response_length=0,
                exception=e,
            )
        return status

    def _sync_request(self, name, collection, variable, params, test_number):
        full_name = f'{test_number:03}: {name}'
        params['skipPreview'] = True

        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name=full_name)

    def _async_request(self, name, collection, variable, params, test_number):
        full_name = f'{test_number:03}: {name}'
        params['skipPreview'] = True

        start_time = time()
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name='async request started')
        self.wait_for_job_completion(response, full_name, start_time)

