import { pick } from 'lodash';
import { IPagination } from 'knex-paginate'; // For types only
import subMinutes from 'date-fns/subMinutes';
import { removeEmptyProperties } from 'util/object';
import { CmrPermission, CmrPermissionsMap, getCollectionsByIds, getPermissions, CmrTagKeys } from 'util/cmr';
import { ConflictError } from '../util/errors';
import { createPublicPermalink } from '../frontends/service-results';
import { truncateString } from '../util/string';
import Record from './record';
import { Transaction } from '../util/db';
import JobLink, { getLinksForJob, JobLinkOrRecord } from './job-link';

import env = require('../util/env');

const { awsDefaultRegion } = env;

const statesToDefaultMessages = {
  accepted: 'The job has been accepted and is waiting to be processed',
  running: 'The job is being processed',
  successful: 'The job has completed successfully',
  failed: 'The job failed with an unknown error',
  canceled: 'The job was canceled',
};

const defaultMessages = Object.values(statesToDefaultMessages);

const serializedJobFields = [
  'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request', 'numInputGranules', 'jobID',
];

const stagingBucketTitle = `Results in AWS S3. Access from AWS ${awsDefaultRegion} with keys from /cloud-access.sh`;

export enum JobStatus {
  ACCEPTED = 'accepted',
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

const terminalStates = [JobStatus.SUCCESSFUL, JobStatus.FAILED, JobStatus.CANCELED];

export interface JobRecord {
  id?: number;
  jobID: string;
  username: string;
  requestId: string;
  status?: JobStatus;
  message?: string;
  progress?: number;
  batchesCompleted?: number;
  links?: JobLinkOrRecord[];
  request: string;
  isAsync?: boolean;
  createdAt?: Date | number;
  updatedAt?: Date | number;
  numInputGranules: number;
  collectionIds: string[];
}

export interface JobQuery {
  id?: number;
  jobID?: string;
  username?: string;
  requestId?: string;
  status?: JobStatus;
  message?: string;
  progress?: number;
  batchesCompleted?: number;
  request?: string;
  isAsync?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/**
 *
 * Wrapper object for persisted jobs
 *
 * Fields:
 *   - id: (integer) auto-number primary key
 *   - jobID: (uuid) ID for the job, currently the same as the requestId, but may change
 *   - username: (string) Earthdata Login username
 *   - requestId: (uuid) ID of the originating user request that produced the job
 *   - status: (enum string) job status ['accepted', 'running', 'successful', 'failed']
 *   - message: (string) human readable status message
 *   - progress: (integer) 0-100 approximate completion percentage
 *   - links: (JSON) links to output files, array of objects containing the following keys:
 *       "href", "title", "type", and "rel"
 *   - request: (string) Original user request URL that created this job
 *   - createdAt: (Date) the date / time at which the job was created
 *   - updatedAt: (Date) the date / time at which the job was last updated
 */
export class Job extends Record {
  static table = 'jobs';

  static statuses: JobStatus;

  links: JobLink[];

  message: string;

  username: string;

  requestId: string;

  progress: number;

  batchesCompleted: number;

  request: string;

  isAsync: boolean;

  status: JobStatus;

  jobID: string;

  originalStatus: JobStatus;

  numInputGranules: number;

  collectionIds: string[];

  /**
   * Returns an array of all jobs that match the given constraints
   *
   * @param transaction - the transaction to use for querying
   * @param constraints - field / value pairs that must be matched for a record to be returned
   * @param getLinks - whether or not to get job links
   * @param currentPage - the index of the page to show
   * @param perPage - the number of results per page
   * @returns a list of all of the user's jobs
   */
  static async queryAll(
    transaction: Transaction,
    constraints: JobQuery = {},
    getLinks = true,
    currentPage = 0,
    perPage = 10,
  ): Promise<{ data: Job[]; pagination: IPagination }> {
    const items = await transaction('jobs')
      .select()
      .where(constraints)
      .orderBy('createdAt', 'desc')
      .paginate({ currentPage, perPage, isLengthAware: true });

    const jobs = items.data.map((j) => new Job(j));
    if (getLinks) {
      for (const job of jobs) {
        job.links = (await getLinksForJob(transaction, job.jobID)).data;
      }
    }

    return {
      data: jobs,
      pagination: items.pagination,
    };
  }

  /**
   * Returns and array of all the the jobs that are still in the RUNNING state, but have not
   * been updated in the given number of minutes
   *
   * @param transaction - the transaction to use for querying
   * @param minutes - any jobs still running and not updated in this many minutes will be returned
   * @param currentPage - the index of the page to show
   * @param perPage - the number of results per page
   * @returns a list of Job's still running but not updated in the given number of minutes
   */
  static async notUpdatedForMinutes(
    transaction: Transaction,
    minutes: number,
    currentPage = 0,
    perPage = 10,
  ):
    Promise<{ data: Job[]; pagination: IPagination }> {
    const pastDate = subMinutes(new Date(), minutes);
    const items = await transaction('jobs')
      .select()
      .where({
        status: JobStatus.RUNNING,
      })
      .where('updatedAt', '<', pastDate)
      .orderBy('createdAt', 'desc')
      .paginate({ currentPage, perPage, isLengthAware: true });

    const jobs = items.data.map((j) => new Job(j));
    for (const job of jobs) {
      job.links = (await getLinksForJob(transaction, job.jobID)).data;
    }
    return {
      data: jobs,
      pagination: items.pagination,
    };
  }

  /**
   * Returns an array of all jobs for the given username using the given transaction
   *
   * @param transaction - the transaction to use for querying
   * @param username - the user whose jobs should be retrieved
   * @param currentPage - the index of the page to show
   * @param perPage - the number of results per page
   * @returns a list of all of the user's jobs
   */
  static forUser(transaction: Transaction, username: string, currentPage = 0, perPage = 10):
  Promise<{ data: Job[]; pagination: IPagination }> {
    return this.queryAll(transaction, { username }, true, currentPage, perPage);
  }

  /**
  * Returns a Job with the given jobID using the given transaction
  *
  * @param transaction - the transaction to use for querying
  * @param jobID - the jobID for the job that should be retrieved
  * @returns the Job with the given JobID or null if not found
  */
  static async byJobID(transaction: Transaction, jobID: string): Promise<Job | null> {
    const jobList = await this.queryAll(transaction, { jobID }, true, 0, 1);
    return jobList.data.shift();
  }

  /**
   * Returns the job matching the given username and request ID, or null if
   * no such job exists.
   *
   * @param transaction - the transaction to use for querying
   * @param username - the username associated with the job
   * @param requestId - the UUID of the request associated with the job
   * @param includeLinks - if true, load all JobLinks into job.links
   * @param currentPage - the index of the page of links to show
   * @param perPage - the number of link results per page
   * @returns the matching job, or null if none exists, along with pagination information
   * for the job links
   */
  static async byUsernameAndRequestId(
    transaction,
    username,
    requestId,
    includeLinks = true,
    currentPage = 0,
    perPage = env.defaultResultPageSize,
  ): Promise<{ job: Job; pagination: IPagination }> {
    const result = await transaction('jobs').select().where({ username, requestId }).forUpdate();
    const job = result.length === 0 ? null : new Job(result[0]);
    let paginationInfo;
    if (job && includeLinks) {
      const linkData = await getLinksForJob(transaction, job.jobID, currentPage, perPage);
      job.links = linkData.data;
      paginationInfo = linkData.pagination;
    }
    return { job, pagination: paginationInfo };
  }

  /**
   * Returns the job matching the given request ID, or null if no such job exists
   *
   * @param transaction - the transaction to use for querying
   * @param requestId - the UUID of the request associated with the job
   * @param currentPage - the index of the page of links to show
   * @param perPage - the number of link results per page
   * @returns the matching job, or null if none exists
   */
  static async byRequestId(
    transaction,
    requestId,
    currentPage = 0,
    perPage = env.defaultResultPageSize,
  ): Promise<{ job: Job; pagination: IPagination }> {
    const result = await transaction('jobs').select().where({ requestId }).forUpdate();
    const job = result.length === 0 ? null : new Job(result[0]);
    let paginationInfo;
    if (job) {
      const linkData = await getLinksForJob(transaction, job.jobID, currentPage, perPage);
      job.links = linkData.data;
      paginationInfo = linkData.pagination;
    }
    return { job, pagination: paginationInfo };
  }

  /**
   * Creates a Job instance.
   *
   * @param fields - Object containing fields to set on the record
   */
  constructor(fields: JobRecord) {
    super(fields);
    this.updateStatus(fields.status || JobStatus.ACCEPTED, fields.message);
    this.progress = fields.progress || 0;
    this.batchesCompleted = fields.batchesCompleted || 0;
    this.links = fields.links ? fields.links.map((l) => new JobLink(l)) : [];
    // collectionIds is stringified json when returned from db
    this.collectionIds = (typeof fields.collectionIds === 'string'
      ? JSON.parse(fields.collectionIds) : fields.collectionIds)
      || [];
    // Job already exists in the database
    if (fields.createdAt) {
      this.originalStatus = this.status;
    }
  }

  /**
   * Validates the job. Returns null if the job is valid.  Returns a list of errors if
   * it is invalid. Other constraints are validated via database constraints.
   *
   * @returns a list of validation errors, or null if the record is valid
   */
  validate(): string[] {
    const errors = [];
    if (this.progress < 0 || this.progress > 100) {
      errors.push('Job progress must be between 0 and 100');
    }
    if (this.batchesCompleted < 0) {
      errors.push('Job batchesCompleted must be greater than or equal to 0');
    }
    if (!this.request.match(/^https?:\/\/.+$/)) {
      errors.push(`Invalid request ${this.request}. Job request must be a URL.`);
    }
    return errors.length === 0 ? null : errors;
  }

  /**
   * Throws an exception if attempting to change the status on a request that's already in a
   * terminal state.
   */
  validateStatus(): void {
    if (terminalStates.includes(this.originalStatus)) {
      throw new ConflictError(`Job status cannot be updated from ${this.originalStatus} to ${this.status}.`);
    }
  }

  /**
   * Adds a link to the list of result links for the job.
   * You must call `#save` to persist the change
   *
   * @param link - Adds a link to the list of links for the object.
   */
  addLink(link: JobLink): void {
    // eslint-disable-next-line no-param-reassign
    link.jobID = this.jobID;
    this.links.push(link);
  }

  /**
   * Adds a staging location link to the list of result links for the job.
   * You must call `#save` to persist the change
   *
   * @param stagingLocation - Adds link to the staging bucket to the list of links.
   */
  addStagingBucketLink(stagingLocation): void {
    if (stagingLocation) {
      const stagingLocationLink = new JobLink({
        href: stagingLocation,
        title: stagingBucketTitle,
        rel: 's3-access',
      });
      this.addLink(stagingLocationLink as JobLink);
    }
  }

  /**
   * Updates the status to failed and message to the supplied error message or the default
   * if none is provided.  You should generally provide an error message if possible, as the
   * default indicates an unknown error.
   * You must call `#save` to persist the change
   *
   * @param message - an error message
   */
  fail(message = statesToDefaultMessages.failed): void {
    this.updateStatus(JobStatus.FAILED, message);
  }

  /**
   * Updates the status to canceled, providing the optional message.
   * You must call `#save` to persist the change
   *
   * @param message - an error message
   */
  cancel(message = statesToDefaultMessages.canceled): void {
    this.updateStatus(JobStatus.CANCELED, message);
  }

  /**
   * Updates the status to success, providing the optional message.  Generally you should
   * only set a message if there is information to provide to users about the result, as
   * providing a message will override any prior message, including warnings.
   * You must call `#save` to persist the change
   *
   * @param message - (optional) a human-readable success message.  See method description.
   */
  succeed(message?: string): void {
    this.updateStatus(JobStatus.SUCCESSFUL, message);
  }

  /**
   * Update the status and status message of a job.  If a null or default message is provided,
   * will use a default message corresponding to the status.
   * You must call `#save` to persist the change
   *
   * @param status - The new status, one of successful, failed, running, accepted
   * @param message - (optional) a human-readable status message
   */
  updateStatus(status: JobStatus, message?: string): void {
    this.status = status;
    if (message) {
      // Update the message if a new one was provided
      this.message = message;
    }
    if (!this.message || defaultMessages.includes(this.message)) {
      // Update the message to a default one if it's currently a default one for a
      // different status
      this.message = statesToDefaultMessages[status];
    }
    if (this.status === JobStatus.SUCCESSFUL) {
      this.progress = 100;
    }
  }

  /**
   * Returns true if the job is complete, i.e. it expects no further interaction with
   * backend services.
   *
   * @returns true if the job is complete
   */
  isComplete(): boolean {
    return terminalStates.includes(this.status);
  }

  /**
   * Checks whether sharing of this job is restricted by any EULAs for
   * any collection used by this job.
   * Defaults to true if any collection does not have the harmony.has-eula tag
   * associated with it.
   * @param accessToken - the token to make the request with
   * @returns true or false
   */
  async collectionsHaveEulaRestriction(accessToken: string): Promise<boolean> {
    const cmrCollections = await getCollectionsByIds(
      this.collectionIds,
      accessToken,
      CmrTagKeys.HasEula,
    );
    if (cmrCollections.length !== this.collectionIds.length) {
      return true;
    }
    return !cmrCollections.every((collection) => (collection.tags
      && collection.tags[CmrTagKeys.HasEula].data === false));
  }

  /**
   * Checks whether CMR guests are restricted from reading any of the collections used in the job.
   * @param accessToken - the token to make the request with
   * @returns true or false
   */
  async collectionsHaveGuestReadRestriction(accessToken: string): Promise<boolean> {
    const permissionsMap: CmrPermissionsMap = await getPermissions(this.collectionIds, accessToken);
    return this.collectionIds.some((collectionId) => (
      !permissionsMap[collectionId]
        || !(permissionsMap[collectionId].indexOf(CmrPermission.Read) > -1)));
  }

  /**
   * Return whether a user can access this job's results and STAC results
   * (Called whenever a request is made to frontend jobs or STAC endpoints)
   * @param requestingUserName - the person we're checking permissions for
   * @param isAdminAccess - whether the requesting user has admin access
   * @param accessToken - the token to make permission check requests with
   * @returns ture or false
   */
  async canShareResultsWith(
    requestingUserName: string,
    isAdminAccess: boolean,
    accessToken: string,
  ): Promise<boolean> {
    if (isAdminAccess || (this.username === requestingUserName)) {
      return true;
    }
    if (!this.collectionIds.length) {
      return false;
    }
    if (await this.collectionsHaveEulaRestriction(accessToken)) {
      return false;
    }
    if (await this.collectionsHaveGuestReadRestriction(accessToken)) {
      return false;
    }
    return true;
  }

  /**
   * Check if the job has any links
   *
   * @param transaction - transaction to use for the query
   * @param rel - if set, only check for job links with this rel type
   * @param requireSpatioTemporal - if true, only check for job links
   *  with spatial and temporal constraints
   * @returns true or false
   */
  async hasLinks(
    transaction,
    rel?: string,
    requireSpatioTemporal = false,
  ): Promise<boolean> {
    const { data } = await getLinksForJob(
      transaction, this.jobID, 1, 1, rel, requireSpatioTemporal,
    );
    return data.length !== 0;
  }

  /**
   * Validates and saves the job using the given transaction.  Throws an error if the
   * job is not valid.  New jobs will be inserted and have their id, createdAt, and
   * updatedAt fields set.  Existing jobs will be updated and have their updatedAt
   * field set.
   *
   * @param transaction - The transaction to use for saving the job
   * @throws {@link Error} if the job is invalid
   */
  async save(transaction: Transaction): Promise<void> {
    // Need to validate the original status before removing it as part of saving to the database
    // May want to change in the future to have a way to have non-database fields on a record.
    this.validateStatus();
    this.message = truncateString(this.message, 4096);
    this.request = truncateString(this.request, 4096);
    const { links, originalStatus, collectionIds } = this;
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore so that we can store stringified json
    this.collectionIds = JSON.stringify(this.collectionIds || []);
    delete this.links;
    delete this.originalStatus;
    await super.save(transaction);
    const promises = [];
    for (const link of links) {
      // Note we will not update existing links in the database - only add new ones
      if (!link.id) {
        promises.push(link.save(transaction));
      }
    }
    await Promise.all(promises);
    this.links = links;
    this.originalStatus = originalStatus;
    this.collectionIds = collectionIds;
  }

  /**
   * Serializes a Job to return from any of the jobs frontend endpoints
   * @param urlRoot - the root URL to be used when constructing links
   * @param linkType - the type to use for data links (http|https =\> https | s3 =\> s3 | none)
   * @returns an object with the serialized job fields.
   */
  serialize(urlRoot?: string, linkType?: string): Job {
    const serializedJob = pick(this, serializedJobFields) as Job;
    serializedJob.updatedAt = new Date(serializedJob.updatedAt);
    serializedJob.createdAt = new Date(serializedJob.createdAt);
    if (urlRoot && linkType !== 'none') {
      serializedJob.links = serializedJob.links.map((link) => {
        const serializedLink = link.serialize();
        let { href } = serializedLink;
        const { title, type, rel, bbox, temporal } = serializedLink;
        // Leave the S3 output staging location as an S3 link
        if (rel !== 's3-access') {
          href = createPublicPermalink(href, urlRoot, type, linkType);
        }
        return removeEmptyProperties({ href, title, type, rel, bbox, temporal });
      }) as unknown as JobLink[];
    }
    const job = new Job(serializedJob as JobRecord); // We need to clean this up
    delete job.originalStatus;
    delete job.batchesCompleted;
    delete job.collectionIds;
    return job;
  }

  /**
   * Returns only the links with a rel that matches the passed in value.
   *
   * @param rel - the relation to return links for
   * @returns the job output links with the given rel
   */
  getRelatedLinks(rel: string): JobLink[] {
    const links = this.links.filter((link) => link.rel === rel);
    return links.map(removeEmptyProperties) as JobLink[];
  }
}
