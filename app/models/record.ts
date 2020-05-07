import db = require('util/db');

/**
 * Abstract class describing a database record.  Subclass database tables
 * must define a unique primary key called `id` and timestamps
 * `created_at` and `updated_at`.
 *
 * In order to save, subclasses must have ClassName.table set to their
 * table name.
 *
 * @class Record
 * @abstract
 */
export default abstract class Record {
  updatedAt: Date;

  createdAt: Date;

  id: any;

  static table: string;

  /**
   * Creates a Record instance (Should not be called directly)
   *
   * @param {object} fields Object containing to set on the record
   * @memberof Record
   */
  constructor(fields) {
    Object.assign(this, fields);
  }

  /**
   * Validates the record.  Returns null if the record is valid.  Returns
   * a list of errors if it is invalid.
   *
   * @returns {string[]} a list of validation errors, or null if the record is valid
   * @memberof Record
   */
  validate() {
    return null;
  }

  /**
   * Validates and saves the record using the given transaction.  Throws an error if the
   * record is not valid.  New records will be inserted and have their id, createdAt, and
   * updatedAt fields set.  Existing records will be updated and have their updatedAt
   * field set.
   *
   * @param {knex.transaction} transaction The transaction to use for saving the record
   * @returns {void}
   * @throws {Error} if the record is invalid
   * @memberof Record
   */
  async save(transaction) {
    const errors = this.validate();
    if (errors) {
      throw new TypeError(`Job record is invalid: ${JSON.stringify(errors)}`);
    }
    this.updatedAt = new Date();
    const newRecord = !this.createdAt;
    if (newRecord) {
      this.createdAt = this.updatedAt;
      let stmt = transaction((this.constructor as any).table).insert(this);
      if (db.engine === 'pg') {
        stmt = stmt.returning('id'); // Postgres requires this to return the id of the inserted record
      }
      [this.id] = await stmt;
    } else {
      await transaction((this.constructor as any).table).where({ id: this.id }).update(this);
    }
  }
}
