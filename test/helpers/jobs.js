const request = require('supertest');
const { before, after } = require('mocha');
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

module.exports = {
  jobsEqual,
  containsJob,
  jobListing,
  jobStatus,
  hookJobListing,
  hookJobStatus };
