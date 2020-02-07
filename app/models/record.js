/**
 * Class describing a database record.  Subclass database tables
 * must define a unique primary key called `id` and timestamps
 * `created_at` and `updated_at`
 *
 * @class Record
 * @abstract
 */
class Record {
  constructor(fields) {
    Object.assign(this, fields);
  }

  validate() {
    return null;
  }

  async save(transaction) {
    const errors = this.validate();
    if (errors) {
      throw new TypeError(`Job record is invalid: ${JSON.stringify(errors)}`);
    }
    this.updatedAt = new Date();
    const newRecord = !this.createdAt;
    if (newRecord) {
      this.createdAt = this.updatedAt;
      await transaction(this.constructor.table).insert(this);
    } else {
      await transaction(this.constructor.table).where({ id: this.id }).update(this);
    }
  }
}

module.exports = Record;
