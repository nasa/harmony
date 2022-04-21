/* eslint-disable no-param-reassign */
import _ from 'lodash';
import logger from '../util/log';
import db, { Transaction } from '../util/db';

export interface RecordConstructor extends Function {
  table: string;
}

/**
 * Before saving a record, set the appropriate date fields.
 * This will mutate the Record and the Partial<Record>.
 * @param fields - the fields to update
 * @param record - the record to update
 * @returns boolean indicating whether this is a new record
 */
function setDateFields(record: Record, fields: Partial<Record>): boolean {
  const updatedAt = new Date();
  record.updatedAt = updatedAt;
  fields.updatedAt = updatedAt;

  const newRecord = !record.createdAt;
  if (newRecord) {
    record.createdAt = record.updatedAt;
    fields.createdAt = record.createdAt;
  }
  return newRecord;
}

/**
 * Abstract class describing a database record.  Subclass database tables
 * must define a unique primary key called `id` and timestamps
 * `created_at` and `updated_at`.
 *
 * In order to save, subclasses must have ClassName.table set to their
 * table name.
 */
export default abstract class Record {
  updatedAt: Date;

  createdAt: Date;

  id: number;

  static table: string;

  /**
   * Creates a Record instance (Should not be called directly)
   *
   * @param fields - Object containing to set on the record
   */
  constructor(fields: object) {
    Object.assign(this, fields);

    // Make sure that updatedAt and createdAt are always Date objects
    const tsWorkaround = fields as unknown as { updatedAt: number; createdAt: number };
    if (tsWorkaround.updatedAt && typeof tsWorkaround.updatedAt === 'number') {
      this.updatedAt = new Date(tsWorkaround.updatedAt);
    }
    if (tsWorkaround.createdAt && typeof tsWorkaround.createdAt === 'number') {
      this.createdAt = new Date(tsWorkaround.createdAt);
    }
  }

  /**
   * Validates the record.  Returns null if the record is valid.  Returns
   * a list of errors if it is invalid.
   *
   * @returns a list of validation errors, or null if the record is valid
   */
  validate(): string[] {
    return null;
  }

  /**
   * Validates and saves the record using the given transaction.  Throws an error if the
   * record is not valid.  New records will be inserted and have their id, createdAt, and
   * updatedAt fields set.  Existing records will be updated and have their updatedAt
   * field set.
   *
   * @param transaction - The transaction to use for saving the record
   * @param fields - The fields to save to the database, defaults to this
   * @throws Error - if the record is invalid
   */
  async save(transaction: Transaction, fields: Partial<Record> = this): Promise<void> {
    const errors = this.validate();
    if (errors) {
      throw new TypeError(`${this.constructor.name} is invalid: ${JSON.stringify(errors)}`);
    }
    const newRecord = setDateFields(this, fields);
    if (newRecord) {
      let stmt = transaction((this.constructor as RecordConstructor).table)
        .insert(fields);
      if (db.client.config.client === 'pg') {
        stmt = stmt.returning('id'); // Postgres requires this to return the id of the inserted record
      }
      try {
        [this.id] = await stmt;
      } catch (e) {
        logger.error(e);
      }
    } else {
      await transaction((this.constructor as RecordConstructor).table)
        .where({ id: this.id })
        .update(fields);
    }
  }

  /**
   * Validates and saves each record (using a single statement).  Throws an error if any
   * record is not valid.  Records will be inserted and have their id, createdAt, and
   * updatedAt fields set. If running SQLite, the id field will not be set as it only returns
   * the last id.
   *
   * @param transaction - The transaction to use for saving the records
   * @param records - The records to save
   * @param fieldsList - The fields to save to the database
   * @throws Error - if the record is invalid
   */
  static async insertBatch(
    transaction: Transaction, 
    records: Record[], 
    fieldsList: Partial<Record>[] = records,
  ): Promise<void> {
    const recordConstructor = records[0]?.constructor;
    const { table } = recordConstructor as RecordConstructor;
    for (const i of _.range(records.length)) {
      const record = records[i];
      const fields = fieldsList[i];
      const errors = record.validate();
      if (errors) {
        throw new TypeError(`${recordConstructor.name} is invalid: ${JSON.stringify(errors)}`);
      }
      setDateFields(record, fields);
    }
    let stmt = transaction(table).insert(fieldsList);
    const isPostgres = db.client.config.client === 'pg';
    if (isPostgres) {
      stmt = stmt.returning('id'); // Postgres requires this to return the id of the inserted record
    }
    try {
      const recordIds = await stmt;
      if (isPostgres) {
        for (const i of _.range(records.length)) {
          records[i].id = recordIds[i];
        }
      }
    } catch (e) {
      logger.error(e);
    }
  }
}