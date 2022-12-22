import db, { Transaction } from './../util/db';
import Record from './record';
import WorkItem from './work-item';

/**
 *
 * Wrapper object for aggregated information tracking the work items summary for a job and service
 *
 */
export default class UserWork extends Record {
  static table = 'user_work';

  // The ID of the job
  job_id: string;

  // unique identifier for the service - this should be the docker image tag (with version)
  service_id: string;

  // The username associated with the job
  username: string;

  // the number of work items in the ready state for this job and service
  ready_count: number;

  // the number of work items in the running state for this job and service
  running_count: number;

  // true if the requested job is asynchronous
  is_async: boolean;

  // the time the job was last worked
  last_worked: Date;
}

/**
 * Get user work record for jobID and serviceID
 *
 */

/**
 * Get a count of work items in the ready or running state for the given service ID
 *
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @returns The sum of ready and running work items for the service
 */
export async function getQueuedAndRunningCountForService(tx: Transaction, serviceID: string)
  : Promise<number> {
  const results = await tx(UserWork.table)
    .sum({ readyCount: 'ready_count', runningCount: 'running_count' })
    // .sum('ready_count').as('ready')
    // .sum('running_count').as('running') // : 'running_count as running' })
    .where({ service_id: serviceID });

  console.log(`CDD: results are ${JSON.stringify(results)} for service ${serviceID}`);
  const totalItems = Number(results[0].readyCount) + Number(results[0].runningCount);
  console.log(`CDD: count is ${totalItems} for service ${serviceID}`);

  return totalItems;
}

/**
 * Gets the next username that should have a work item worked for the given service ID
 * SELECT username, SUM("u"."running_count") as s from user_work u WHERE username in
 * (SELECT DISTINCT username FROM user_work u WHERE "u"."service_id" = 'ghcr.io/podaac/l2ss-py:2.2.0' AND "u"."ready_count" \> 0)
 * GROUP BY username order by s, max(last_worked) asc LIMIT 1;

 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @returns The username that should have a work item worked next
 */
export async function getNextUsernameForWork(tx: Transaction, serviceID: string)
  : Promise<string> {
  const subquery = tx(UserWork.table)
    .distinct('username')
    .where('service_id', '=', serviceID)
    .where('ready_count',  '>',  0);

  const results = await tx(UserWork.table)
    .select('username')
    .max('last_worked as lw')
    .sum('running_count as rc')
    .whereIn('username', subquery)
    .groupBy('username')
    .orderBy('rc', 'asc')
    .orderBy('lw', 'asc')
    .first();

  return results?.username;
}

/**
 * Gets the next job to work on for the given username and service ID.
 * select job_id from user_work where username = <username> and ready_count \> 0 order by last_worked asc limit 1
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @param username - The username to choose a job to work on
 * @returns The job ID that should have a work item worked next for the service
 */
export async function getNextJobIdForUsernameAndService(tx: Transaction, serviceID: string, username: string)
  : Promise<string> {
  const results = await tx(UserWork.table)
    .select('job_id')
    .where({ username, service_id: serviceID })
    .where('ready_count', '>', 0)
    .orderBy('is_async', 'asc')
    .orderBy('last_worked', 'asc')
    .first();

  return results.job_id;
}

// export async function insertUserWork(tx: Transaction, userWork: Partial<UserWork>)
//   : Promise<string> {
//   const results = await tx(UserWork.table).insert(userWork);
// }
// 10 more to go
// Just use the generic save record function for any kind of inserts

/**
 * Deletes all of the rows for the given job from the user_work table.
 * delete from user_work where job_id = $job_id
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @returns the number of rows deleted
 */
export async function deleteUserWorkForJob(tx: Transaction, jobID: string): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ job_id: jobID })
    .del();
  return numDeleted;
}

/**
 * Deletes all of the rows for the given job from the user_work table.
 * delete from user_work where job_id = $job_id
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @returns the number of rows deleted
 */
export async function deleteUserWorkForJobAndService(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .del();
  return numDeleted;
}

/**
 * Adds one to the ready_count for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param additionalReadyCount - additional number of items that are now ready - defaults to 1
 * @param serviceID - The ID of the service
 */
export async function incrementReadyCount(
  tx: Transaction, jobID: string, serviceID: string, additionalReadyCount = 1,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .increment('ready_count', additionalReadyCount);
}

/**
 * Sets the ready_count to 0 for the given jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function setReadyCountToZero(tx: Transaction, jobID: string): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID })
    .update('ready_count', 0);
}

/**
 * Populates the user_work table for the given jobID from the work_items table.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function populateUserWorkForJobId(tx: Transaction, jobID: string): Promise<void> {
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
  + `AND "j"."jobID" = '${jobID}' `
  + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
  + 'ORDER BY "j"."updatedAt" asc';
  await tx.raw(sql);
}

/**
 * Sets the ready_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function recalculateReadyCount(tx: Transaction, jobID: string): Promise<void> {
  const rows = await tx(UserWork.table)
    .select(['id', 'service_id'])
    .where({ job_id: jobID });

  // Job was paused at initial transition and populating of user_work table
  if (rows.length === 0) {
    await populateUserWorkForJobId(tx, jobID);
  } else {
    for (const row of rows) {
      const readyCountRow = await tx(WorkItem.table)
        .count()
        .where({ jobID, serviceID: row.service_id, status: 'ready' })
        .first();

      let key = 'count(*)';
      if (db.client.config.client === 'pg') {
        key = 'count';
      }
      await tx(UserWork.table)
        .where({ id: row.id })
        .update('ready_count', readyCountRow[key]);
    }
  }
}

/**
 * Adds one to the running_count and subtracts one from the ready_count for the given
 * jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function incrementRunningAndDecrementReadyCounts(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .increment('running_count')
    .decrement('ready_count')
    .update({ 'last_worked': new Date() });
}

/**
 * Adds one to the ready_count and subtracts one from the running_count for the given
 * jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function incrementReadyAndDecrementRunningCounts(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .increment('ready_count')
    .decrement('running_count');
}

/**
 * Decrements the running_count by one for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function decrementRunningCount(
  tx: Transaction, jobID: string, serviceID: string,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .decrement('running_count');
}

/**
 * Deletes any rows with 0 running_count and 0 ready_count
 * @param tx - The database transaction
 * @returns the number of rows deleted
 */
export async function deleteOrphanedRows(tx: Transaction): Promise<number> {
  const numDeleted = await tx(UserWork.table)
    .where({ ready_count: 0, running_count: 0 })
    .del();
  return numDeleted;
}

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