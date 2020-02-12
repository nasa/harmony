const uuid = require('uuid');
const request = require('supertest');
const { before, after } = require('mocha');
const { auth } = require('./auth');


// Example jobs to use in tests
const woodyJob1 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'successful',
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1' }],
};

const woodyJob2 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 60,
  links: [],
};

const buzzJob1 = {
  username: 'buzz',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 30,
  links: [],
};

/**
 * Returns true if two jobs are the same (ignoring timestamps)
 * @param {Object} job1 first job
 * @param {Object} job2 second job
 * @returns {Boolean} true if the jobs are the same
 */
function jobsEqual(job1, job2) {
  return (job1.requestId === job2.requestId
    && job1.username === job2.username
    && job1.message && job2.message
    && job1.progress && job2.progress
    && job1.status === job2.status
    && job1.links.length === job2.links.length);
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
  woodyJob1,
  woodyJob2,
  buzzJob1,
  jobsEqual,
  containsJob,
  jobListing,
  jobStatus,
  hookJobListing,
  hookJobStatus };
