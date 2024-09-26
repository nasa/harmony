import { Transaction } from '../util/db';

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
  const query = transaction('labels')
    .where({ job_id: jobID })
    .orderBy(['labels.id'])
    .innerJoin('user_labels', 'labels.user_label_id', '=', 'user_labels.id')
    .select(['user_labels.value']);

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
  await transaction('labels')
    .where({ job_id: jobID })
    .delete();

  if (labels.length > 0) {
    const now = new Date();
    const lowerCaseLabels = labels.map((label) => label.toLowerCase());
    const userLabelRows = lowerCaseLabels.map((label) => {
      return { username, value: label, createdAt: now, updatedAt: now };
    });

    const insertedRows = await transaction('user_labels')
      .insert(userLabelRows)
      .returning('id')
      .onConflict(['username', 'value'])
      .merge(['updatedAt']);

    const ids = insertedRows.map((row) => row.id);
    const labelRows = ids.map((id) => {
      return { job_id: jobID, user_label_id: id, createdAt: now, updatedAt: now };
    });

    await transaction('labels').insert(labelRows);
  }
}