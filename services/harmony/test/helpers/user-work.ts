import UserWork from '../../app/models/user-work';
import db, { Transaction } from '../../app/util/db';

/**
 * Populates the user_work table from scratch using the work_items table.
 * @param tx - The database transaction
 */
export async function populateUserWorkFromWorkItems(tx: Transaction): Promise<void> {
  let now = 'datetime(\'now\')';
  if (db.client.config.client === 'pg') {
    now = 'now()';
  }
  const sql = 'INSERT INTO user_work(ready_count, running_count, last_worked, service_id, '
    + 'job_id, username, is_async, "createdAt", "updatedAt") '
    + 'SELECT count(1) filter (WHERE i.status = \'ready\' AND "i"."serviceID" = "ws"."serviceID" AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as ready_count, '
    + 'count(1) filter (WHERE i.status = \'running\' AND j.status in (\'running\', \'running_with_errors\', \'accepted\')) as running_count, '
    + `"j"."updatedAt", ws."serviceID", "ws"."jobID", j.username, "j"."isAsync", ${now}, ${now} `
    + 'FROM workflow_steps ws '
    + 'JOIN jobs j on "ws"."jobID" = "j"."jobID" '
    + 'LEFT JOIN work_items i on "ws"."jobID" = "i"."jobID" AND "i"."jobID" = "j"."jobID" '
    + 'WHERE j.status not in (\'successful\', \'complete_with_errors\', \'failed\', \'canceled\') '
    + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
    + 'ORDER BY "j"."updatedAt" asc';
  await tx.raw(sql);
}

/**
 * Get the running_count or ready_count for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @param readyOrRunning - The work item state (ready or running)
 * @returns the count
 */
export async function getCount(
  tx: Transaction, jobID: string, serviceID: string, readyOrRunning: 'ready' | 'running',
): Promise<number> {
  const record = await tx(UserWork.table)
    .select(`${readyOrRunning}_count`)
    .where({ job_id: jobID, service_id: serviceID })
    .first();
  return record[`${readyOrRunning}_count`];
}

/**
 * Adds before / after hooks to populate the user_work table in the database from the
 * entries in the work_items table.
 */
export function hookPopulateUserWorkFromWorkItems(): void {
  before(async function () {
    await populateUserWorkFromWorkItems(db);
  });
  after(async function () {
    await db(UserWork.table).truncate();
  });
}

/**
 * Sets the running_count and ready_count for a given row in the user work table.
 *
 * @param tx - the database transaction
 * @param id - the database identifier for the UserWork row
 * @param readyCount - the count to set for ready_count
 * @param runningCount - the count to set for running_count
 */
export async function setCounts(
  tx: Transaction, id: number, readyCount: number, runningCount: number,
): Promise<void> {
  await tx(UserWork.table)
    .where({ id })
    .update({ running_count: runningCount, ready_count: readyCount });
}

/**
 * Returns a UserWork record
 *
 * @param fields - UserWork fields to set. All fields are optional and any fields not set
 * will use a default value.
 * @returns UserWork record
 */
export function createUserWorkRecord(fields: Partial<UserWork> = {}): UserWork {
  const { average_duration } = fields;
  let {
    job_id, service_id, username, ready_count, running_count, is_async, last_worked,
    completed_count,
  } = fields;
  job_id = job_id || 'foo';
  service_id = service_id || 'bar';
  username = username || 'joe';
  ready_count = ready_count || 0;
  running_count = running_count || 0;
  is_async = is_async || false;
  last_worked = last_worked || new Date();
  completed_count = completed_count || 0;
  const failed_count = fields.failed_count || 0;
  const failed_sum_duration_ms = fields.failed_sum_duration_ms || 0;
  return new UserWork({
    job_id, service_id, username, ready_count, running_count, is_async, last_worked,
    average_duration, completed_count, failed_count, failed_sum_duration_ms,
  });
}

/**
 * Returns true if a user_work row exists for the given job_id and service_id
 */
export async function rowExists(job_id: string, service_id: string): Promise<boolean> {
  const row = await db(UserWork.table).where({ job_id, service_id }).first();
  return row !== undefined;
}
