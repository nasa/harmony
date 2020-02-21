const pick = require('lodash.pick');
const Record = require('./record');
const { createPublicPermalink } = require('../frontends/service-results');

const statesToDefaultMessages = {
  accepted: 'The job has been accepted and is waiting to be processed',
  running: 'The job is being processed',
  successful: 'The job has completed successfully',
  failed: 'The job failed with an unknown error',
};

// Enum of valid statuses
const statuses = {
  ACCEPTED: 'accepted',
  RUNNING: 'running',
  SUCCESSFUL: 'successful',
  FAILED: 'failed',
};

const defaultMessages = Object.values(statesToDefaultMessages);

const serializedJobFields = [
  'requestId', 'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links',
];

/**
 *
 * Wrapper object for persisted jobs
 *
 * Fields:
 *   - id: (integer) auto-number primary key
 *   - username: (string) Earthdata Login username
 *   - requestId: (uuid) ID of the originating user request that produced the job
 *   - status: (enum string) job status ['accepted', 'running', 'successful', 'failed']
 *   - message: (string) human readable status message
 *   - progress: (integer) 0-100 approximate completion percentage
 *   - links: (JSON) links to output files, array of objects containing "href", "title", "type"
 *   - createdAt: (Date) the date / time at which the job was created
 *   - updatedAt: (Date) the date / time at which the job was last updated
 *
 * @class Job
 */
class Job extends Record {
  /**
   * Returns an array of all jobs for the given username using the given transaction
   *
   * @static
   * @param {knex.transaction} transaction the transaction to use for querying
   * @param {string} username the user whose jobs should be retrieved
   * @returns {Job[]} a list of all of the user's jobs
   * @memberof Job
   */
  static async forUser(transaction, username) {
    // Enables users getting a list of all their jobs
    return transaction('jobs').select().where({ username }).map((j) => new Job(j));
  }

  /**
   * Returns the job matching the given username and request ID, or null if
   * no such job exists.
   *
   * @static
   * @param {knex.transaction} transaction the transaction to use for querying
   * @param {string} username the username associated with the job
   * @param {string} requestId the UUID of the request associated with the job
   * @returns {Job} the matching job, or null if none exists
   * @memberof Job
   */
  static async byUsernameAndRequestId(transaction, username, requestId) {
    const result = await transaction('jobs').select().where({ username, requestId }).forUpdate();
    return result.length === 0 ? null : new Job(result[0]);
  }

  /**
   * Returns the job matching the given request ID, or null if no such job exists
   *
   * @static
   * @param {knex.transaction} transaction the transaction to use for querying
   * @param {string} requestId the UUID of the request associated with the job
   * @returns {Job} the matching job, or null if none exists
   * @memberof Job
   */
  static async byRequestId(transaction, requestId) {
    const result = await transaction('jobs').select().where({ requestId }).forUpdate();
    return result.length === 0 ? null : new Job(result[0]);
  }

  /**
   * Returns the job matching the given primary key id, or null if no such job exists
   *
   * @static
   * @param {knex.transaction} transaction the transaction to use for querying
   * @param {Integer} id the primary key of the job record
   * @returns {Job} the matching job, or null if none exists
   * @memberof Job
   */
  static async byId(transaction, id) {
    const result = await transaction('jobs').select().where({ id }).forUpdate();
    return result.length === 0 ? null : new Job(result[0]);
  }

  /**
   * Creates a Job instance.
   *
   * @param {object} fields Object containing fields to set on the record
   * @memberof Job
   */
  constructor(fields) {
    super(fields);
    this.updateStatus(fields.status || 'accepted', fields.message);
    this.progress = fields.progress || 0;
    // Need to jump through serialization hoops due array caveat here: http://knexjs.org/#Schema-json
    this.links = fields.links
    || (typeof fields._json_links === 'string' ? JSON.parse(fields._json_links) : fields._json_links)
    || [];
  }

  /**
   * Validates the job, ensuring progress is within the allowable bounds.  Returns null
   * if the job is valid.  Returns a list of errors if it is invalid.  Other constraints
   * are validated via database constraints.
   *
   * @returns {string[]} a list of validation errors, or null if the record is valid
   * @memberof Job
   */
  validate() {
    const errors = [];
    if (this.progress < 0 || this.progress > 100) {
      errors.push('Job progress must be between 0 and 100');
    }
    return errors.length === 0 ? null : errors;
  }

  /**
   * Adds a link to the list of result links for the job.
   * You must call `#save` to persist the change
   *
   * @param {Object<{
   *   href: string,
   *   title: string,
   *   type: string
   * }>} link Adds a link to the list of links for the object.
   * @returns {void}
   * @memberof Job
   */
  addLink(link) {
    this.links.push(link);
  }

  /**
   * Updates the status to failed and message to the supplied error message or the default
   * if none is provided.  You should generally provide an error message if possible, as the
   * default indicates an unknown error.
   * You must call `#save` to persist the change
   *
   * @param {string} [message=statesToDefaultMessages.failed] an error message
   * @returns {void}
   * @memberof Job
   */
  fail(message = statesToDefaultMessages.failed) {
    this.updateStatus(statuses.FAILED, message);
  }

  /**
   * Updates the status to success, providing the optional message.  Generally you should
   * only set a message if there is information to provide to users about the result, as
   * providing a message will override any prior message, including warnings.
   * You must call `#save` to persist the change
   *
   * @param {string} message (optional) a human-readable success message.  See method description.
   * @returns {void}
   * @memberof Job
   */
  succeed(message) {
    this.updateStatus(statuses.SUCCESSFUL, message);
  }

  /**
   * Update the status and status message of a job.  If a null or default message is provided,
   * will use a default message corresponding to the status.
   * You must call `#save` to persist the change
   *
   * @param {string} status The new status, one of successful, failed, running, accepted
   * @param {string} message (optional) a human-readable status message
   * @returns {void}
   * @memberof Job
   */
  updateStatus(status, message) {
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
    if (this.status === statuses.SUCCESSFUL) {
      this.progress = 100;
    }
  }

  /**
   * Returns true if the job is complete, i.e. it expects no further interaction with
   * backend services.
   *
   * @returns {boolean} true if the job is complete
   * @memberof Job
   */
  isComplete() {
    return this.status === statuses.SUCCESSFUL || this.status === statuses.FAILED;
  }

  /**
   * Validates and saves the job using the given transaction.  Throws an error if the
   * job is not valid.  New jobs will be inserted and have their id, createdAt, and
   * updatedAt fields set.  Existing jobs will be updated and have their updatedAt
   * field set.
   *
   * @param {knex.transaction} transaction The transaction to use for saving the job
   * @returns {void}
   * @throws {Error} if the job is invalid
   * @memberof Job
   */
  async save(transaction) {
    // Need to jump through serialization hoops due array caveat here: http://knexjs.org/#Schema-json
    const { links } = this;
    delete this.links;
    this._json_links = JSON.stringify(links);
    await super.save(transaction);
    this.links = links;
    delete this._json_links;
  }

  /**
   * Serializes a Job to return from any of the jobs frontend endpoints
   * @param {string} urlRoot the root URL to be used when constructing links
   * @returns {Object} an object with the serialized job fields.
   */
  serialize(urlRoot) {
    const serializedJob = pick(this, serializedJobFields);
    serializedJob.updatedAt = new Date(serializedJob.updatedAt);
    serializedJob.createdAt = new Date(serializedJob.createdAt);
    serializedJob.jobID = serializedJob.requestId;
    serializedJob.links = serializedJob.links.map((link) => ({
      href: createPublicPermalink(link.href, urlRoot),
      title: link.title,
      type: link.type,
    }));
    delete serializedJob.requestId;
    return serializedJob;
  }
}

Job.table = 'jobs';
Job.statuses = statuses;

module.exports = Job;
