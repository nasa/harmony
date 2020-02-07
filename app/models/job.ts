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
  static async forUser(transaction, username) {
    // Enables users getting a list of all their jobs
    return transaction('jobs').select().where({ username }).map((j) => new Job(j));
  }

  static async forUserAndRequestId(transaction, username, requestId) {
    return transaction('jobs').select().where({ username, requestId }).map((j) => new Job(j));
  }

  static async byUserAndId(transaction, username, id) {
    const result = await transaction('jobs').select().where({ username, id }).forUpdate();
    if (result.length === 0) {
      return null;
    }
    return new Job(result[0]);
  }

  constructor(fields) {
    super(fields);
    this.status = fields.status || 'accepted';
    this.message = fields.message || this.status;
    this.progress = fields.progress || 0;
    // Need to jump through serialization hoops due array caveat here: http://knexjs.org/#Schema-json
    this.links = fields.json_links ? JSON.parse(fields.json_links) : [];
  }

  validate() {
    const errors = [];
    if (this.progress < 0 || this.progress > 100) {
      errors.push('Job progress must be between 0 and 100');
    }
    return errors.length === 0 ? null : errors;
  }

  async save(transaction) {
    // Need to jump through serialization hoops due array caveat here: http://knexjs.org/#Schema-json
    const { links } = this;
    delete this.links;
    this.json_links = JSON.stringify(links);
    await super.save(transaction);
    this.links = links;
  }
}
Job.table = 'jobs';

module.exports = Job;
