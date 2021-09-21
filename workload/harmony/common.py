from time import time, sleep
from locust import HttpUser, task, tag, between, events
from locust.exception import RescheduleTask
import requests
import logging
from threading import Thread, Lock

from contextlib import contextmanager, ContextDecorator

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
        """
        body = response.json()
        status = None
        try:
            while body['status'] not in ['successful', 'failed', 'canceled']:
                sleep(1)
                try:
                    with self.client.get(response.url, name='ignore') as response:
                        body = response.json()
                        # if body['status'] not in ['successful', 'failed', 'canceled']:
                        status = body['status']
                        raise RescheduleTask()
                except Exception as e:
                    # This is fine
                    pass
            raise 'End'
        except Exception as e:
          assert(status not in ['failed', 'canceled'])
          events.request.fire(
            context=self.context,
            request_type='async_job',
            name=name,
            response_time=(time() - start_time) * 1000,
            response_length=0,
            exception=None,
        )
        # raise RescheduleTask()
        return status

@contextmanager
def _manual_report(name):
    start_time = time()
    try:
        yield
    except Exception as e:
        events.request.fire(
            request_type="manual",
            name=name,
            response_time=(time() - start_time) * 1000,
            response_length=0,
            exception=e,
        )
        raise
    else:
        events.request.fire(
            request_type="manual",
            name=name,
            response_time=(time() - start_time) * 1000,
            response_length=0,
            exception=None,
        )


def manual_report(name_or_func):
    if callable(name_or_func):
        # used as decorator without name argument specified
        return _manual_report(name_or_func.__name__)(name_or_func)
    else:
        return _manual_report(name_or_func)
