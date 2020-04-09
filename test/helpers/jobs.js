const request = require('supertest');
const { before, after, it } = require('mocha');
const { expect } = require('chai');
const { auth } = require('./auth');

/**
 * Returns true if the passed in job record matches the serialized Job
 * @param {Object} jobRecord a job record
 * @param {Object} serializedJob a job record serialized
 * @returns {Boolean} true if the jobs are the same
 */
function jobsEqual(jobRecord, serializedJob) {
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
function containsJob(job, jobList) {
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
function jobListing(app) {
  return request(app).get('/jobs');
}

/**
 * Adds before/after hooks to navigate to the job listing route
 *
 * @param {String} username optional user to simulate logging in as
 * @returns {void}
 */
function hookJobListing(username = undefined) {
  before(async function () {
    if (username) {
      this.res = await jobListing(this.frontend).use(auth({ username }));
    } else {
      this.res = await jobListing(this.frontend);
    }
  });
  after(function () {
    delete this.res;
  });
}

/**
 * Navigates to the job status route as the given user
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {String} jobId The job ID
 * @returns {void}
 */
function jobStatus(app, jobId) {
  return request(app).get(`/jobs/${jobId}`);
}

/**
 * Adds before/after hooks to navigate to the job status route
 *
 * @param {String} jobId The job ID
 * @param {String} username optional user to simulate logging in as
 * @returns {void}
 */
function hookJobStatus(jobId, username = undefined) {
  before(async function () {
    if (username) {
      this.res = await jobStatus(this.frontend, jobId).use(auth({ username }));
    } else {
      this.res = await jobStatus(this.frontend, jobId);
    }
  });
  after(function () {
    delete this.res;
  });
}

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
function itIncludesRequestUrl(expectedPath) {
  it('returns a request field with the URL used to generate the request', function () {
    const job = JSON.parse(this.res.text);
    // If the request is not a URL this will throw an exception
    // eslint-disable-next-line no-unused-vars
    const parsed = new URL(job.request);
    const regex = new RegExp(`^https?://.*${_escapeRegExp(expectedPath)}$`);
    expect(job.request).to.match(regex);
  });
}

const cloudAccessLinks = [{
  href: 's3://localStagingBucket/public/harmony/gdal/<uuid>/',
  title: 'S3 bucket and prefix where all job outputs can be directly accessed using S3 APIs from within the us-west-2 region. Use the harmony /cloud-access or /cloud-access.sh endpoints to obtain keys for direct in region S3 access.',
}, {
  href: 'http://localhost:3000/cloud-access.sh',
  title: 'Obtain AWS access keys for in-region (us-west-2) S3 access to job outputs. The credentials are returned as a shell script that can be sourced.',
  type: 'application/x-sh',
}, {
  href: 'http://localhost:3000/cloud-access',
  title: 'Obtain AWS access keys for in-region (us-west-2) S3 access to job outputs. The credentials are returned as JSON.',
  type: 'application/json',
}];

module.exports = {
  jobsEqual,
  containsJob,
  jobListing,
  jobStatus,
  hookJobListing,
  hookJobStatus,
  itIncludesRequestUrl,
  cloudAccessLinks,
};
