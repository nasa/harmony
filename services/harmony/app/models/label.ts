import { Transaction } from '../util/db';

/**
 * Returns an error message if a label is empty or exceeds 255 characters in length
 *
 * @param tag - The image tag to check
 * @returns An error message if the tag is not valid, null otherwise
 */
export function checkLabel(label: string): string {
  if (label.length < 1 || label.length > 255) {
    const message = 'Labels must consist of at least one 1 and no more than 255 characters.';
    return message;
  }
  return null;
}

/**
 * Returns the labels for a given job
 * @param transaction - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 *
 * @returns A promise that resolves to an array of strings, one for each label
 */
export async function getLabelsForJob(
  transaction: Transaction,
  jobID: string,
): Promise<string[]> {
  const query = transaction('jobs_labels')
    .where({ job_id: jobID })
    .orderBy(['jobs_labels.id'])
    .innerJoin('labels', 'jobs_labels.label_id', '=', 'labels.id')
    .select(['labels.value']);

  const rows = await query;

  return rows.map((row) => row.value);
}

/**
 *  Set the labels for a given job/user. This is atomic - all the labels are set at once. Any
 * existing labels are replaced.
 * @param transaction - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 * @param username - the username the labels belong to
 * @param labels - the array of strings representing the labels. These will be forced to lower-case.
 * If this is an empty array then any existing labels for the job will be cleared.
 */
export async function setLabelsForJob(
  transaction: Transaction,
  jobID: string,
  username: string,
  labels: string[],
): Promise<void> {

  if (!labels) return;

  // delete any labels that already exist for the job
  await transaction('jobs_labels')
    .where({ job_id: jobID })
    .delete();

  if (labels.length > 0) {
    const now = new Date();
    const lowerCaseLabels = labels.map((label) => label.toLowerCase());
    const labelRows = lowerCaseLabels.map((label) => {
      return { username, value: label, createdAt: now, updatedAt: now };
    });

    // this will insert the labels - if a label already exists for a given user
    // it will just update the `updatedAt` timestamp
    const insertedRows = await transaction('labels')
      .insert(labelRows)
      .returning('id')
      .onConflict(['username', 'value'])
      .merge(['updatedAt']);

    const ids = insertedRows.map((row) => row.id);
    const jobsLabelRows = ids.map((id) => {
      return { job_id: jobID, label_id: id, createdAt: now, updatedAt: now };
    });

    await transaction('jobs_labels').insert(jobsLabelRows);
  }
}