import { afterEach, beforeEach } from 'mocha';
import request from 'supertest';
import url from 'url';
import { Job } from '../../app/models/job';
import db from '../../app/util/db';
import { getNextCallback } from '../../example/http-backend';

/**
 * Adds before / after hooks calling the http backend service, awaiting the initial invocation,
 * and making sure the request completes in the after hook.  `this.userPromise` is a promise to
 * the HTTP response to the Harmony request made by `fn`.  `this.callback` is the callback URL
 * for the service request.
 * @param fn - A function that makes a Harmony request, returning a promise
 *   for its result
 */
export function hookHttpBackendEach(fn): void {
  beforeEach(async function () {
    const callbackPromise = getNextCallback();
    this.userPromise = fn.call(this);
    this.userPromise.then(); // The supertest request won't get sent until `then` is called
    const callbackRoot = await callbackPromise;
    this.callback = `${new url.URL(callbackRoot).pathname}/response`;
  });

  afterEach(async function () {
    // Both of these should succeed, but their sequence depends on async vs sync, so use Promise.all
    await Promise.all([
      this.userPromise,
      request(this.backend).post(this.callback).query({ status: 'successful', httpBackend: 'true' }),
    ]);
  });
}

/**
 * Adds a beforeEach hook to provide a callback and await its processing
 *
 * @param fn - A function that takes a callback request and returns it augmented with any query
 *   params, post bodies, etc
 * @param finish - True if the hook should wait for the user request to finish
 */
export function hookCallbackEach(fn: (req: request.Test) => request.Test, finish = false): void {
  beforeEach(async function () {
    this.callbackRes = await fn(request(this.backend).post(this.callback));
    if (finish) {
      this.userResp = await this.userPromise;
    }
  });
}

/**
 * Loads the job for the provided callback URL
 * @param callback - the callback URL for the job that needs to be loaded
 */
export async function loadJobForCallback(callback: string): Promise<Job> {
  const jobID = callback.replace('/response', '').split('/').pop();
  return (await Job.byJobID(db, jobID, true, true)).job;
}
