import request, { Test } from 'supertest';
import { it } from 'mocha';
import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import { Transaction } from 'knex';
import { Application } from 'express';
import JobLink from 'models/job-link';
import _ from 'lodash';
import { Job, JobStatus, JobRecord } from '../../app/models/job';
import { JobListing } from '../../app/frontends/jobs';
import db from '../../app/util/db';
import { hookRequest } from './hooks';
import { truncateAll } from './db';

export const adminUsername = 'adam';

export const expectedJobKeys = [
  'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request', 'numInputGranules', 'jobID',
];

export const expectedNoOpJobKeys = expectedJobKeys.filter((k) => k !== 'jobID');

const exampleProps = {
  username: 'anonymous',
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [{ href: 'http://example.com' }],
  request: 'http://example.com/harmony?foo=bar',
  numInputGranules: 100,
  isAsync: true,
} as JobRecord;

/**
 * Creates a job with default values for fields that are not passed in
 *
 * @param fields - fields to use for the job record
 * @returns a job
 */
export function buildJob(fields: Partial<JobRecord> = {}): Job {
  const requestId = uuid().toString();
  const job = new Job({ requestId, jobID: requestId, ...exampleProps, ...fields });
  // Make sure the jobID and the requestId always match
  job.jobID = job.requestId;

  const jobLinks = job.links;
  if (jobLinks) {
    for (const jobLink of jobLinks) {
      jobLink.jobID = requestId;
      if (jobLink.temporal) {
        if (jobLink.temporal.start && typeof jobLink.temporal.start === 'string') {
          jobLink.temporal.start = new Date(jobLink.temporal.start);
        }
        if (jobLink.temporal.end && typeof jobLink.temporal.end === 'string') {
          jobLink.temporal.end = new Date(jobLink.temporal.end);
        }
      }
    }
  }
  return job;
}

/**
 * Compare links from a saved Job to those of a serialized job
 * @param jobLinks - links from a saved job
 * @param serializedJobLinks - links from a serialized job
 * @returns true if the links are the same, false otherwise
 */
export function areJobLinksEqual(jobLinks: JobLink[], serializedJobLinks: JobLink[]): boolean {
  const cleanedLinks = jobLinks.map((link) => _.pick(link, ['href', 'title', 'type', 'rel']));
  const cleanedLinksSet = new Set<JobLink>(cleanedLinks);
  const serializedLinksSet = new Set<JobLink>(serializedJobLinks);
  return _.isEqual(cleanedLinksSet, serializedLinksSet);
}

/**
 * Compare link titles from a saved Job to those of the STAC catalog output
 * @param jobLinks - links from a saved job
 * @param stacLinks - links from STAC catalog
 * @returns true if the links are the same, false otherwise
 */
export function areStacJobLinksEqual(jobLinks: JobLink[], stacLinks: JobLink[]): boolean {
  const cleanedStacLinks = stacLinks.map((link) => _.pick(link, ['title']));
  const cleanedJobLinks = jobLinks.map((link) => _.pick(link, ['title']));
  const cleanedStacLinksSet = new Set<JobLink>(cleanedStacLinks);
  const cleanedJobLinksSet = new Set<JobLink>(cleanedJobLinks);
  return _.isEqual(cleanedStacLinksSet, cleanedJobLinksSet);
}

/**
 * Returns true if the passed in job record matches the serialized Job for all fields
 * and all links with rel === data
 *
 * @param jobRecord - a job record
 * @param serializedJob - a job record serialized
 * @param skipLinks - if true links are not used in the comparison
 * @returns true if the jobs are the same
 */
export function jobsEqual(jobRecord: JobRecord, serializedJob: Job, skipLinks = false): boolean {
  const recordLinks = new Job(jobRecord).getRelatedLinks('data');
  const serializedLinks = serializedJob.getRelatedLinks('data');

  return (jobRecord.requestId === serializedJob.jobID
    && jobRecord.username === serializedJob.username
    && jobRecord.message && serializedJob.message
    && jobRecord.progress && serializedJob.progress
    && jobRecord.status === serializedJob.status
    && jobRecord.request === serializedJob.request
    && (skipLinks || areJobLinksEqual(recordLinks, serializedLinks)));
}

/**
 * Returns true if the job is found in the passed in job list. Job links are not used in the
 * comparisons.
 *
 * @param job - The job to search for
 * @param jobList - An array of jobs
 * @returns true if the object is found
 */
export function containsJob(job: JobRecord, jobList: JobListing): boolean {
  return !!jobList.jobs.find((j) => jobsEqual(job, new Job(j), true));
}

/**
 * Makes a job listing request
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
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
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 * @param query - Mapping of query param names to values
 */
export function jobStatus(app: Express.Application, options): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/jobs/${jobID}`).query(actualQuery);
}

/**
 * Navigates to the job status route as the given user
 *
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 */
export function adminJobStatus(app: Express.Application, options): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/jobs/${jobID}`).query(actualQuery);
}

/**
 * Submits a cancel job request as the given user
 *
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 */
export function cancelJob(app: Express.Application, { jobID }: Job): Test {
  return request(app).post(`/jobs/${jobID}/cancel`);
}

/**
 * Submits a cancel job request as the given user
 *
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 */
export function adminCancelJob(app: Express.Application, { jobID }: Job): Test {
  return request(app).post(`/admin/jobs/${jobID}/cancel`);
}

/**
 * Submits a cancel job request as the given user using a GET instead of POST
 *
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 */
export function cancelJobWithGET(app: Express.Application, { jobID }: Job): Test {
  return request(app).get(`/jobs/${jobID}/cancel`);
}

/**
 * Submits a cancel job request as the given user using a GET instead of POST
 *
 * @param app - The express application (typically this.frontend)
 * @param job - The job
 */
export function adminCancelJobWithGET(app: Express.Application, { jobID }: Job): Test {
  return request(app).get(`/admin/jobs/${jobID}/cancel`);
}

export const hookJobListing = hookRequest.bind(this, jobListing);
export const hookAdminJobListing = hookRequest.bind(this, adminJobListing);
export const hookJobStatus = hookRequest.bind(this, jobStatus);
export const hookAdminJobStatus = hookRequest.bind(this, adminJobStatus);
export const hookCancelJob = hookRequest.bind(this, cancelJob);
export const hookAdminCancelJob = hookRequest.bind(this, adminCancelJob);
export const hookCancelJobWithGET = hookRequest.bind(this, cancelJobWithGET);
export const hookAdminCancelJobWithGET = hookRequest.bind(this, adminCancelJobWithGET);

/**
 * Given a string returns a new string with all characters escaped such that the string
 * can be used in a regular expression.
 *
 * @param s - the string to escape
 * @returns the escaped string to use in a regular expression
 */
function _escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Asserts that the request URL contains the expected path.
 *
 * @param expectedPath - the expected relative path and query string
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
    const job = buildJob({ username, request: `http://example.com/${progress}`, numInputGranules: count, progress });
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
  path: string,
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
        expect(actual.href).to.include(`${path}?page=${expectedPage}&limit=${limit}`);
        expect(actual.title).to.include(`(${expectedPage} of ${pageCount})`);
      });
    }
  }
}

/**
 * Adds before / after hooks to create a job with the given properties, saving it
 * to the DB, and storing it in `this.job`
 * @param props - properties to set on the job
 * @param beforeFn - The mocha `before` function to use, i.e. `before` or `beforeEach`
 * @param afterFn - The mocha `after` function to use, i.e. `after` or `afterEach`
 */
export function hookJobCreation(
  props: Partial<JobRecord> = {},
  beforeFn = before,
  afterFn = after,
): void {
  beforeFn(async function () {
    this.job = buildJob(props);
    await this.job.save(db);
  });

  afterFn(async function () {
    delete this.job;
    await truncateAll();
  });
}

/**
 * Adds beforeEach / afterEach hooks to create a job with the given properties, saving it
 * to the DB, and storing it in `this.job`
 * @param props - properties to set on the job
 */
export function hookJobCreationEach(props: Partial<JobRecord> = {}): void {
  hookJobCreation(props, beforeEach, afterEach);
}
