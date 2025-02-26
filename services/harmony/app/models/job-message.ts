import { truncateString } from '@harmony/util/string';
import db, { Transaction } from '../util/db';
import Record from './record';

export enum JobMessageLevel {
  ERROR = 'error',
  WARNING = 'warning',
}

export interface JobMessageRecord {
  id?: number;
  jobID: string;
  url: string;
  message: string;
  level: JobMessageLevel;
  message_category?: string;

  createdAt?: Date | number;
  updatedAt?: Date | number;
}

/**
 *
 * Wrapper object for persisted job messages
 *
 */
export default class JobMessage extends Record {
  static table = 'job_messages';

  jobID: string;

  url: string;

  level: JobMessageLevel;

  message: string;

  message_category?: string;

  /**
   * Creates a Job message object for a work item that failed or warned in a job.
   *
   * @param fields - Object containing fields to set on the record
   */
  constructor(fields: JobMessageRecord) {
    super(fields);
    this.jobID = fields.jobID;
    this.url = fields.url;
    this.level = this.level;
    this.message = truncateString(fields.message, 4096);
    this.message_category = fields.message_category;
  }

  /**
   * Validates the job message record. Returns null if the job message is valid.
   * Returns a list of errors if it is invalid.
   *
   * @returns a list of validation messages or null if the job message is valid
   */
  validate(): string[] {
    const errors = [];
    if (!this.url) {
      errors.push('Job message must include a URL');
    }
    if (!this.message) {
      errors.push('Job message must include a message');
    }
    if (!this.level) {
      errors.push('Job message must include a level');
    }
    return errors.length === 0 ? null : errors;
  }
}

/**
 * Returns the job messages for a given job
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param n - the max number of messages to retrieve
 *
 * @returns A promise that resolves to an array of job messages
 */
export async function getMessagesForJob(
  tx: Transaction,
  jobID: string,
  n?: number,
): Promise<JobMessage[]> {
  const results = await tx(JobMessage.table).select()
    .where({ jobID })
    .orderBy(['id'])
    .modify(async (queryBuilder) => {
      if (Number.isInteger(n) && n > 0) {
        await queryBuilder.limit(n);
      }
    });

  const messages = results.map((e) => new JobMessage(e));
  return messages;
}

/**
 * Returns the messages for a given job and message level
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param level - optional message level (defaults to ERROR)
 * @param n - the max number of messages to retrieve
 *
 * @returns A promise that resolves to an array of job errors
 */
async function getMessagesForJobAndLevel(
  tx: Transaction,
  jobID: string,
  level: JobMessageLevel = JobMessageLevel.ERROR,
  n?: number,
): Promise<JobMessage[]> {
  const results = await tx(JobMessage.table).select()
    .where({ jobID, level })
    .orderBy(['id'])
    .modify(async (queryBuilder) => {
      if (Number.isInteger(n) && n > 0) {
        await queryBuilder.limit(n);
      }
    });

  const messages = results.map((e) => new JobMessage(e));
  return messages;
}

/**
 * Returns the error messages for a given job
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param n - the max number of errors to retrieve
 *
 * @returns A promise that resolves to an array of job errors
 */
export async function getErrorMessagesForJob(
  tx: Transaction,
  jobID: string,
  n?: number,
): Promise<JobMessage[]> {
  return getMessagesForJobAndLevel(tx, jobID, JobMessageLevel.ERROR, n);
}

/**
 * Returns the warning messages for a given job
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param n - the max number of warnings to retrieve
 *
 * @returns A promise that resolves to an array of job warnings
 */
export async function getWarningMessagesForJob(
  tx: Transaction,
  jobID: string,
  n?: number,
): Promise<JobMessage[]> {
  return getMessagesForJobAndLevel(tx, jobID, JobMessageLevel.WARNING, n);
}

/**
 * Returns the number of messages for the given job and (optional) message level
 *
 * @param tx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param level - optional message level (defaults to ERROR)
 *
 * @returns A promise that resolves to the message count
 */
export async function getMessageCountForJob(
  tx: Transaction,
  jobID: string,
  level: JobMessageLevel = JobMessageLevel.ERROR,
): Promise<number> {
  const count = await tx(JobMessage.table)
    .select()
    .count('id')
    .where({ jobID, level });

  let messageCount: number;
  if (db.client.config.client === 'pg') {
    messageCount = Number(count[0].count);
  } else {
    messageCount = Number(count[0]['count(`id`)']);
  }
  return messageCount;
}