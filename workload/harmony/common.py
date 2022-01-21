from time import time, sleep
from locust import HttpUser, task, tag, between, events
import logging
from threading import Thread, Lock

session_cookies = None
mutex = Lock()

class BaseHarmonyUser(HttpUser):
    abstract = True
    wait_time = between(1, 2)
    coverages_root = '/{collection}/ogc-api-coverages/1.0.0/collections/{variable}/coverage/rangeset'

    def on_start(self):
        global session_cookies, mutex
        self.client.trust_env = True
        try:
            mutex.acquire()
            if session_cookies is None:
                logging.info('Using cloud-access endpoint to set up shared session cookies')
                self.client.get('/cloud-access', name='Set up shared session cookies')
                session_cookies = self.client.cookies
            else:
                self.client.cookies = session_cookies
        finally:
            mutex.release()

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

        self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name=full_name)

    def _async_request(self, name, collection, variable, params, test_number):
        full_name = f'{test_number:03}: {name}'

        start_time = time()
        response = self.client.get(
            self.coverages_root.format(
                collection=collection,
                variable=variable),
            params=params,
            name='async request started')
        self.wait_for_job_completion(response, full_name, start_time)

