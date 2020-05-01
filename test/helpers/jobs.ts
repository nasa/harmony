import request from 'supertest';
import { it } from 'mocha';
import { expect } from 'chai';

import { hookRequest } from './hooks';

/**
 * Returns true if the passed in job record matches the serialized Job
 * @param {Object} jobRecord a job record
 * @param {Object} serializedJob a job record serialized
 * @returns {Boolean} true if the jobs are the same
 */
export function jobsEqual(jobRecord, serializedJob) {
  return (jobRecord.requestId === serializedJob.jobID
    && jobRecord.username === serializedJob.username
    && jobRecord.message && serializedJob.message
    && jobRecord.progress && serializedJob.progress
    && jobRecord.status === serializedJob.status
    && jobRecord.request === serializedJob.request
    && jobRecord.links.length === serializedJob.links.length);
}

/**
 * Returns true if the job is found in the passed in job list
 *
 * @param {Object} job The job to search for
 * @param {Array} jobList An array of jobs
 * @returns {Boolean} true if the object is found
 */
export function containsJob(job, jobList) {
  let found = false;
  jobList.forEach((j) => {
    if (jobsEqual(j, job)) {
      found = true;
    }
  });
  return found;
}

/**
 * Makes a job listing request
 * @param {Express.Application} app The express application (typically this.frontend)
 * @returns {Promise<Response>} The response
 */
export function jobListing(app) {
  return request(app).get('/jobs');
}

/**
 * Navigates to the job status route as the given user
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {Object} [options.jobID] The job ID
 * @returns {void}
 */
export function jobStatus(app, { jobID }) {
  return request(app).get(`/jobs/${jobID}`);
}

export const hookJobListing = hookRequest.bind(this, jobListing);
export const hookJobStatus = hookRequest.bind(this, jobStatus);

/**
 * Given a string returns a new string with all characters escaped such that the string
 * can be used in a regular expression.
 *
 * @param {string} s the string to escape
 * @returns {string} the escaped string to use in a regular expression
 */
function _escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Adds before / after hooks in mocha to inject an instance of StubService
 * into service invocations within the current context. Makes the real service call
 * after replacing the docker image that would have been used with the passed in
 * docker image name.
 *
 * @param {string} expectedPath the expected relative path and query string
 * @returns {void}
 */
export function itIncludesRequestUrl(expectedPath) {
  it('returns a request field with the URL used to generate the request', function () {
    const job = JSON.parse(this.res.text);
    // If the request is not a URL this will throw an exception
    // eslint-disable-next-line no-unused-vars
    const parsed = new URL(job.request);
    const regex = new RegExp(`^https?://.*${_escapeRegExp(expectedPath)}$`);
    expect(job.request).to.match(regex);
  });
}
