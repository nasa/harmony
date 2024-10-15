import { Transaction } from '../util/db';
import { Job } from './job';
import { NotFoundError, RequestValidationError } from '../util/errors';
import isUUID from '../util/uuid';

export const LABELS_TABLE = 'raw_labels';
export const JOBS_LABELS_TABLE = 'jobs_raw_labels';
export const USERS_LABELS_TABLE = 'users_labels';

/**
 * Returns an error message if a label exceeds 255 characters in length
 *
 * @param label - The label to check
 * @returns An error message if the label is not valid, null otherwise
 */
export function checkLabel(label: string): string {
  if (label.length > 255) {
    const message = 'Labels may not exceed 255 characters in length.';
    return message;
  }
  return null;
}

/**
 * Trim the whitespace from the beginning/end of a label and convert it to lowercase
 *
 * @param label - the label to normalize
 * @returns - label converted to lowercase with leading/trailing whitespace trimmed
 */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Verify that the user can change the labels on a given job. Currently only job owners and admin can
 * change the labels for a job.
 * @param trx - the transaction to use for querying
 * @param jobIds - the UUIDs associated with the jobs
 * @throws `ForbiddenError` if the user does not own the job.
 */
export async function verifyUserAccessToUpdateLabels(
  trx: Transaction,
  jobIds: string[],
  username: string,
  isAdmin: boolean = false): Promise<void> {
  for (const jobId of jobIds) {
    if (!isUUID(jobId)) {
      throw new RequestValidationError(`jobId ${jobId} is in invalid format.`);
    }
  }
  const rows = await trx(Job.table).select('jobID', 'username')
    .where('jobID', 'in', jobIds);
  const foundJobs = [];
  for (const row of rows) {
    const jobId = row.jobID;
    const jobOwner = row.username;
    if (jobOwner != username && !isAdmin) {
      throw new NotFoundError();
    }
    foundJobs.push(jobId);
  }

  for (const jobId of jobIds) {
    if (!foundJobs.includes(jobId)) {
      throw new NotFoundError(`Unable to find job ${jobId}`);
    }
  }
}

/**
 * Save labels for a user to the raw_labels table and to the users_labels table
 *
 * @param trx - the transaction to use for querying
 * @param labels - the string values for the labels
 * @param username - the user adding the labels
 * @returns A list of the ids of the saved labels
 */
async function saveLabels(
  trx: Transaction,
  labels: string[],
  timeStamp: Date,
  username: string): Promise<string[]> {
  const uniqueLabels = Array.from(new Set(labels));
  const labelRows = uniqueLabels.map((label) => {
    return { value: label, createdAt: timeStamp, updatedAt: timeStamp };
  });

  // this will 'upsert' the labels - if a label already exists
  // it will just update the `updatedAt` timestamp
  const insertedRows = await trx(LABELS_TABLE)
    .insert(labelRows)
    .returning(['id', 'value'])
    .onConflict(['value'])
    .merge(['updatedAt']);

  const usersRawLabelsRows = [];
  for (const row of insertedRows) {
    usersRawLabelsRows.push({ username, value: row.value, createdAt: timeStamp, updatedAt: timeStamp });
  }

  await trx(USERS_LABELS_TABLE)
    .insert(usersRawLabelsRows)
    .onConflict(['username', 'value'])
    .merge(['updatedAt']);

  return insertedRows.map((row) => row.id);
}

/**
 * Returns the labels for a given job
 * @param trx - the transaction to use for querying
 * @param jobId - the UUID associated with the job
 *
 * @returns A promise that resolves to an array of strings, one for each label
 */
export async function getLabelsForJob(
  trx: Transaction,
  jobId: string,
): Promise<string[]> {
  const query = trx(JOBS_LABELS_TABLE)
    .where({ job_id: jobId })
    .orderBy([`${LABELS_TABLE}.value`])
    .innerJoin(LABELS_TABLE, `${JOBS_LABELS_TABLE}.label_id`, '=', `${LABELS_TABLE}.id`)
    .select([`${LABELS_TABLE}.value`]);

  const rows = await query;

  return rows.map((row) => row.value);
}

/**
 * Returns the labels for a given user
 * @param trx - the transaction to use for querying
 * @param username - the username associated with the labels
 *
 * @returns A promise that resolves to an array of strings, one for each label
 */
export async function getLabelsForUser(
  trx: Transaction,
  username: string,
): Promise<string[]> {
  const query = trx(USERS_LABELS_TABLE)
    .select(['value'])
    .where({ username });

  const rows = (await query).map((object) => object.value);
  console.log(rows);
  return rows;
}

/**
 *  Set the labels for a given job/user. This is atomic - all the labels are set at once. Any
 * existing labels are replaced.
 * @param trx - the transaction to use for querying
 * @param jobId - the UUID associated with the job
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels. These will be forced to lower-case.
 * If this is an empty array then any existing labels for the job will be cleared.
 */
export async function setLabelsForJob(
  trx: Transaction,
  jobId: string,
  username: string,
  labels: string[],
): Promise<void> {

  if (!labels) return;

  // delete any labels that already exist for the job
  await trx(JOBS_LABELS_TABLE)
    .where({ job_id: jobId })
    .delete();

  if (labels.length > 0) {
    const now = new Date();
    const ids = await saveLabels(trx, labels, now, username);
    const jobsLabelRows = ids.map((id) => {
      return { job_id: jobId, label_id: id, createdAt: now, updatedAt: now };
    });

    await trx(JOBS_LABELS_TABLE).insert(jobsLabelRows);
  }
}

/**
 *  Add labels to the given jobs for the given user. Any labels that already exist for the given
 * job will not be re-added or replaced.
 * @param trx - the transaction to use for querying
 * @param jobIds - the UUIDs associated with the jobs
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels.
 */
export async function addLabelsToJobs(
  trx: Transaction,
  jobIds: string[],
  username: string,
  labels: string[],
  isAdmin: boolean = false,
): Promise<void> {
  await verifyUserAccessToUpdateLabels(trx, jobIds, username, isAdmin);
  const now = new Date();
  const labelIds = await saveLabels(trx, labels, now, username);
  const rowsToAdd = [];
  for (const jobId of jobIds) {
    for (const labelId of labelIds) {
      rowsToAdd.push({ job_id: jobId, label_id: labelId, createdAt: now, updatedAt: now });
    }
  }
  if (rowsToAdd.length > 0) {
    await trx(JOBS_LABELS_TABLE).insert(rowsToAdd)
      .onConflict(['job_id', 'label_id'])
      .merge(['updatedAt']);
  }
}

/**
 *  Delete one or more labels from the given jobs for the given user.
 * @param trx - the transaction to use for querying
 * @param jobIds - the UUIDs associated with the jobs
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels.
 * @param isAdmin - true if the user is an admin user
 */
export async function deleteLabelsFromJobs(
  trx: Transaction,
  jobIds: string[],
  username: string,
  labels: string[],
  isAdmin: boolean = false,
): Promise<void> {
  await verifyUserAccessToUpdateLabels(trx, jobIds, username, isAdmin);

  // unfortunately sqlite doesn't seem to like deletes with joins, so we have to do this in two
  // queries
  const labelIds = await trx(`${LABELS_TABLE}`)
    .select('id')
    .where('value', 'in', labels);
  await trx(`${JOBS_LABELS_TABLE}`)
    .where('job_id', 'in', jobIds)
    .andWhere('label_id', 'in', labelIds.map(row => row.id))
    .del();
}
