import db, { Transaction } from '../util/db';
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
 * Get a count of work items in the ready or running state for the given service ID
 *
 * @param tx - The database transaction
 * @param serviceID - The ID of the service
 * @returns The sum of ready and running work items for the service
 */
export async function getQueuedOrRunningCountForService(tx: Transaction, serviceID: string)
  : Promise<number> {
  const results = await tx(UserWork.table)
    .sum({ readyCount: 'ready_count', runningCount: 'running_count' })
    .where({ service_id: serviceID });

  const totalItems = Number(results[0].readyCount) + Number(results[0].runningCount);

  return totalItems;
}

/**
 * Gets the next username that should have a work item worked for the given service ID
 * SELECT username, SUM("u"."running_count") as s from user_work u WHERE username in
 * (SELECT DISTINCT username FROM user_work u WHERE "u"."service_id" = 'SERVICE' AND "u"."ready_count" \> 0)
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

/**
 * Returns the jobIds with the oldest last_worked value and ready count greater than 0 and interleaved by username.
 * This query enforces the fair queueing by returning the job ids in the order of fair queueing priority.
 * @param tx - The database transaction
 * @param serviceID - The service ID
 * @param batchSize - The batch size
 * @returns The list of job ids in fair queuring priority
 */
export async function getNextJobIds(
  tx: Transaction,
  serviceID: string,
  batchSize: number)
  : Promise<string[]> {
  const sql = 'WITH RankedJobs AS ( '
  + 'SELECT job_id, last_worked, username, is_async, ROW_NUMBER() OVER (PARTITION BY username ORDER BY last_worked ASC) AS user_row_num '
  + `FROM user_work WHERE service_id = '${serviceID}' and ready_count > 0`
  + ') SELECT job_id FROM ( '
  + 'SELECT R.job_id, R.last_worked, R.username, R.is_async, ROW_NUMBER() OVER (ORDER BY R.user_row_num, R.last_worked ASC) AS overall_row_num '
  + `FROM RankedJobs R) Interleaved WHERE overall_row_num <= ${batchSize} ORDER BY is_async, overall_row_num`;
  const results = await tx.raw(sql);
  return results.rows.map((r) => r.job_id) || [];
}

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
 * Deletes all of the rows for the given job and service ID from the user_work table.
 * delete from user_work where job_id = $job_id and service_id = $service_id
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
 * Get the running_count or ready_count for the given jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 * @param readyOrRunning - The work item state (ready or running)
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
 * Sets the ready and running count to 0 for the given jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function setReadyAndRunningCountToZero(tx: Transaction, jobID: string): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID })
    .update('ready_count', 0)
    .update('running_count', 0);
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
  + 'AND ws.is_complete IS NOT TRUE '
  + 'GROUP BY "j"."updatedAt", "ws"."serviceID", "ws"."jobID", j.username, "j"."isAsync" '
  + 'ORDER BY "j"."updatedAt" asc';
  await tx.raw(sql);
}

/**
 * Sets the ready_count or running_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param readyOrRunning - The work item state (ready or running)
 */
export async function recalculateCount(tx: Transaction, jobID: string, readyOrRunning: 'ready' | 'running'): Promise<void> {
  const rows = await tx(UserWork.table)
    .select(['id', 'service_id'])
    .where({ job_id: jobID });

  // Job was paused at initial transition and populating of user_work table
  if (rows.length === 0) {
    await populateUserWorkForJobId(tx, jobID);
  } else {
    for (const row of rows) {
      const readyOrRunningCountRow = await tx(WorkItem.table)
        .count()
        .where({ jobID, serviceID: row.service_id, status: readyOrRunning })
        .first();

      let key = 'count(*)';
      if (db.client.config.client === 'pg') {
        key = 'count';
      }
      await tx(UserWork.table)
        .where({ id: row.id })
        .update(`${readyOrRunning}_count`, readyOrRunningCountRow[key]);
    }
  }
}

/**
 * Sets the ready_count and running_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function recalculateCounts(tx: Transaction, jobID: string): Promise<void> {
  await recalculateCount(tx, jobID, 'ready');
  await recalculateCount(tx, jobID, 'running');
}

/**
 * Sets the ready_count to the appropriate value for each row in the user_work table for the
 * provided jobID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 */
export async function recalculateReadyCount(tx: Transaction, jobID: string): Promise<void> {
  await recalculateCount(tx, jobID, 'ready');
}

/**
 * Adds one to the running_count and subtracts one from the ready_count for the given
 * jobID and serviceID.
 * @param tx - The database transaction
 * @param jobID - The job ID
 * @param serviceID - The ID of the service
 */
export async function incrementRunningAndDecrementReadyCounts(
  tx: Transaction, jobID: string, serviceID: string, count = 1,
): Promise<void> {
  await tx(UserWork.table)
    .where({ job_id: jobID, service_id: serviceID })
    .update({
      ready_count: tx.raw(`CASE WHEN ready_count >= ${count} THEN ready_count - ${count} ELSE 0 END`),
      last_worked: new Date(),
    })
    .increment('running_count', count);
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
    .update({
      running_count: tx.raw('CASE WHEN running_count > 0 THEN running_count - 1 ELSE 0 END'),
    });
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
    .update({
      running_count: tx.raw('CASE WHEN running_count > 0 THEN running_count - 1 ELSE 0 END'),
    });
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
