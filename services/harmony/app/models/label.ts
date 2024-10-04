import { Transaction } from '../util/db';
import { Job } from './job';
import { ForbiddenError, NotFoundError, RequestValidationError } from '../util/errors';
import isUUID from '../util/uuid';

export const LABELS_TABLE = 'labels';
export const JOBS_LABELS_TABLE = 'jobs_labels';

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
 * Verify that the user can change the labels on a give job. Currently only job owners can
 * change the labels for a job.
 * @param trx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @throws `ForbiddenError` if the user does not own the job.
 */
export async function verifyUserAccessToUpdateLabels(
  trx: Transaction,
  jobID: string,
  username: string): Promise<void> {
  if (!isUUID(jobID)) {
    throw new RequestValidationError(`jobId ${jobID} is in invalid format.`);
  }
  const jobOwner = await trx(Job.table).select('username').where('jobID', '=', jobID).first();
  console.log(`JOB OWNER: ${JSON.stringify(jobOwner, null, 2)}`);
  if (!jobOwner) {
    throw new NotFoundError('Job does not exist');
  }
  console.log(`USER NAME: ${username}  JOB OWNER: ${JSON.stringify(jobOwner, null, 2)}`);
  if (username !== jobOwner.username) {
    throw new ForbiddenError('You do not have permission to update labels on this job');
  }
}

/**
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
  const labelRows = labels.map((label) => {
    return { username, value: label, createdAt: timeStamp, updatedAt: timeStamp };
  });

  // this will upsert the labels - if a label already exists for a given user
  // it will just update the `updatedAt` timestamp
  const insertedRows = await trx(LABELS_TABLE)
    .insert(labelRows)
    .returning('id')
    .onConflict(['username', 'value'])
    .merge(['updatedAt']);

  return insertedRows.map((row) => row.id);
}

/**
 * Returns the labels for a given job
 * @param trx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 *
 * @returns A promise that resolves to an array of strings, one for each label
 */
export async function getLabelsForJob(
  trx: Transaction,
  jobID: string,
): Promise<string[]> {
  const query = trx(JOBS_LABELS_TABLE)
    .where({ job_id: jobID })
    .orderBy([`${JOBS_LABELS_TABLE}.id`])
    .innerJoin(LABELS_TABLE, `${JOBS_LABELS_TABLE}.label_id`, '=', `${LABELS_TABLE}.id`)
    .select([`${LABELS_TABLE}.value`]);

  const rows = await query;

  return rows.map((row) => row.value);
}

/**
 *  Set the labels for a given job/user. This is atomic - all the labels are set at once. Any
 * existing labels are replaced.
 * @param trx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels. These will be forced to lower-case.
 * If this is an empty array then any existing labels for the job will be cleared.
 */
export async function setLabelsForJob(
  trx: Transaction,
  jobID: string,
  username: string,
  labels: string[],
): Promise<void> {

  if (!labels) return;

  // delete any labels that already exist for the job
  await trx(JOBS_LABELS_TABLE)
    .where({ job_id: jobID })
    .delete();

  if (labels.length > 0) {
    const now = new Date();
    const ids = await saveLabels(trx, labels, now, username);
    const jobsLabelRows = ids.map((id) => {
      return { job_id: jobID, label_id: id, createdAt: now, updatedAt: now };
    });

    await trx(JOBS_LABELS_TABLE).insert(jobsLabelRows);
  }
}

/**
 *  Add labels to a given job for the given user. Any labels that already exist for the given
 * job will not be re-added or replaced.
 * @param trx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels.
 */
export async function addLabelsToJob(
  trx: Transaction,
  jobID: string,
  username: string,
  labels: string[],
): Promise<void> {
  await verifyUserAccessToUpdateLabels(trx, jobID, username);
  const now = new Date();
  const existingLabels = await getLabelsForJob(trx, jobID);
  const labelsToAdd = labels.filter(label => !existingLabels.includes(label));
  if (labelsToAdd.length > 0) {
    const ids = await saveLabels(trx, labelsToAdd, now, username);
    const jobsLabelRows = ids.map((id) => {
      return { job_id: jobID, label_id: id, createdAt: now, updatedAt: now };
    });

    await trx(JOBS_LABELS_TABLE).insert(jobsLabelRows);
  }
}

/**
 *  Delete labels from a given job for the given user.
 * @param trx - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels.
 */
export async function deleteLabelsFromJob(
  trx: Transaction,
  jobID: string,
  username: string,
  labels: string[],
): Promise<void> {
  await verifyUserAccessToUpdateLabels(trx, jobID, username);

  await trx(JOBS_LABELS_TABLE)
    .where(`${JOBS_LABELS_TABLE}.job_id`, '=', jobID)
    .join(LABELS_TABLE, `${JOBS_LABELS_TABLE}.label_id`, '=', `${LABELS_TABLE}.id`)
    .where(`${LABELS_TABLE}.value`, 'in', labels)
    .del();
}