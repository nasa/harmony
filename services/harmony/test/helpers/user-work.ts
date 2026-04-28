import UserWork, { populateUserWorkFromWorkItems } from '../../app/models/user-work';
import db, { Transaction } from '../../app/util/db';

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
  let { job_id, service_id, username, ready_count, running_count, is_async, last_worked } = fields;
  job_id = job_id || 'foo';
  service_id = service_id || 'bar';
  username = username || 'joe';
  ready_count = ready_count || 0;
  running_count = running_count || 0;
  is_async = is_async || false;
  last_worked = last_worked || new Date();
  return new UserWork({
    job_id, service_id, username, ready_count, running_count, is_async, last_worked,
  });
}
