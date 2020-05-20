import request, { Test } from 'supertest';
import { it } from 'mocha';
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { Transaction } from 'knex';
import { Application } from 'express';
import { Job, JobStatus, JobRecord } from 'harmony/models/job';
import { JobListing } from 'harmony/frontends/jobs';
import { hookRequest } from './hooks';

/**
 * Returns true if the passed in job record matches the serialized Job
 * @param {Object} jobRecord a job record
 * @param {Object} serializedJob a job record serialized
 * @returns {Boolean} true if the jobs are the same
 */
export function jobsEqual(jobRecord: JobRecord, serializedJob: Job): boolean {
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
export function containsJob(job: JobRecord, jobList: JobListing): boolean {
  return !!jobList.jobs.find((j) => jobsEqual(job, j));
}

/**
 * Makes a job listing request
 * @param {Application} app The express application (typically this.frontend)
 * @param {object} query Mapping of query param names to values
 * @returns {Test} The response
 */
export function jobListing(app: Application, query: object = {}): Test {
  return request(app).get('/jobs').query(query);
}


/**
 * Makes a job listing request
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
 */
export function adminJobListing(app: Application, query: object = {}): Test {
  return request(app).get('/admin/jobs').query(query);
}

/**
 * Navigates to the job status route as the given user
 *
 * @param {Express.Application} app The express application (typically this.frontend)
 * @param {Object} [options.jobID] The job ID
 * @returns {void}
 */
export function jobStatus(app: Express.Application, { jobID }): Test {
  return request(app).get(`/jobs/${jobID}`);
}

export const hookJobListing = hookRequest.bind(this, jobListing);
export const hookAdminJobListing = hookRequest.bind(this, adminJobListing);
export const hookJobStatus = hookRequest.bind(this, jobStatus);

/**
 * Given a string returns a new string with all characters escaped such that the string
 * can be used in a regular expression.
 *
 * @param {string} s the string to escape
 * @returns {string} the escaped string to use in a regular expression
 */
function _escapeRegExp(s: string): string {
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
export function itIncludesRequestUrl(expectedPath: string): void {
  it('returns a request field with the URL used to generate the request', function () {
    const job = JSON.parse(this.res.text);
    // If the request is not a URL this will throw an exception
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const parsed = new URL(job.request);
    const regex = new RegExp(`^https?://.*${_escapeRegExp(expectedPath)}$`);
    expect(job.request).to.match(regex);
  });
}


/**
 * Creates a batch of jobs owned by the given username, using the given transaction, where the
 * `progress` int of each job is set to the index in which it should appear in the default jobs
 * array, i.e. the last job has progress 0, the second to last has progress 1, etc.
 * @param trx - the transaction to use when creating jobs
 * @param username - the username of the user who owns the job
 * @param count - the number of jobs to create
 * @returns the list of jobs created in descending order of creation time
 */
export async function createIndexedJobs(
  trx: Transaction,
  username: string,
  count: number,
): Promise<Job[]> {
  const result = [];
  let created = +new Date() - 100;
  for (let progress = count - 1; progress >= 0; progress--) {
    const job = new Job({
      username,
      requestId: uuid().toString(),
      status: JobStatus.RUNNING,
      message: 'In progress',
      progress,
      links: [],
      request: `http://example.com/${progress}`,
    });
    await job.save(trx);
    // Explicitly set created dates to ensure they are sequential (must be done in an update)
    job.createdAt = new Date(created++);
    await job.save(trx);
    result.unshift(job);
  }
  return result;
}

/**
 * Relates a link `rel` to an expected page number
 */
export interface PagingRelationInfo {
  'first': number;
  'prev': number;
  'self': number;
  'next': number;
  'last': number;
}

/**
 * Provides `it` statements asserting that the provided paging relations are available in `this.res`
 * and have the correct link values relative to the supplied current page.  If a page number is set
 * to null, asserts that the relation is not present.
 * @param pageCount - the total number of pages available
 * @param relations - a map of link relations to their expected page numbers
 * @param limit - the number of items on each page (default = 10)
 */
export function itIncludesPagingRelations(
  pageCount: number,
  relations: PagingRelationInfo,
  limit = 10,
): void {
  for (const rel of Object.keys(relations)) {
    const expectedPage = relations[rel];
    if (expectedPage === null || expectedPage === undefined) {
      it(`does not provide a "${rel}" link relation`, function () {
        const listing = JSON.parse(this.res.text);
        const actual = listing.links.find((link) => link.rel === rel);
        expect(actual).to.not.exist;
      });
    } else {
      it(`provides a "${rel}" link relation with correctly set page and limit parameters`, function () {
        const listing = JSON.parse(this.res.text);
        const actual = listing.links.find((link) => link.rel === rel);
        expect(actual).to.exist;
        expect(actual.href).to.include(`/jobs?page=${expectedPage}&limit=${limit}`);
        expect(actual.title).to.include(`(${expectedPage} of ${pageCount})`);
      });
    }
  }
}
