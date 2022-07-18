import db, { Transaction } from '../util/db';
import Record from './record';

export interface JobErrorRecord {
  id?: number;
  jobID: string;
  url: string;
  message: string;
  createdAt?: Date | number;
  updatedAt?: Date | number;
}

/**
 *
 * Wrapper object for persisted job errors
 *
 */
export default class JobError extends Record {
  static table = 'job_errors';

  jobID: string;

  url: string;

  message: string;

  /**
   * Creates a Job error object for a work item that failed in a job.
   *
   * @param fields - Object containing fields to set on the record
   */
  constructor(fields: JobErrorRecord) {
    super(fields);
    this.jobID = fields.jobID;
    this.url = fields.url;
    this.message = fields.message;
  }

  /**
   * Validates the job error record. Returns null if the job error is valid.
   * Returns a list of errors if it is invalid.
   *
   * @returns a list of validation errors or null if the job error is valid
   */
  validate(): string[] {
    const errors = [];
    if (!this.url) {
      errors.push('Job error must include a URL');
    }
    if (!this.message) {
      errors.push('Job error must include a message');
    }
    return errors.length === 0 ? null : errors;
  }
}

/**
 * Returns the errors for a given job
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 *
 * @returns A promise that resolves to an array of job errors
 */
export async function getErrorsForJob(
  tx: Transaction,
  jobID: string,
): Promise<JobError[]> {
  const results = await tx(JobError.table).select()
    .where({ jobID })
    .orderBy(['id']);

  const errors = results.map((e) => new JobError(e));
  return errors;
}

/**
 * Returns the number of errors for the given job
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 */
export async function getErrorCountForJob(
  tx: Transaction,
  jobID: string,
): Promise<number> {
  const count = await tx(JobError.table)
    .select()
    .count('id')
    .where({ jobID });

  let errorCount;
  if (db.client.config.client === 'pg') {
    errorCount = Number(count[0].count);
  } else {
    errorCount = Number(count[0]['count(`id`)']);
  }
  return errorCount;
}