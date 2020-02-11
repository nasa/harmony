const Record = require('./record');

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
   * @param {object} fields Object containing to set on the record
   * @memberof Job
   */
  constructor(fields) {
    super(fields);
    this.status = fields.status || 'accepted';
    this.message = fields.message || this.status;
    this.progress = fields.progress || 0;
    // Need to jump through serialization hoops due array caveat here: http://knexjs.org/#Schema-json
    this.links = fields.links || (fields._json_links ? JSON.parse(fields._json_links) : []);
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
  }
}

Job.table = 'jobs';

module.exports = Job;
