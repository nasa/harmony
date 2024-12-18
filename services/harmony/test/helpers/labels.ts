import request, { Test } from 'supertest';
import { auth } from './auth';

/**
 * Submits an add labels request
 *
 * @param app - The express application (typically this.frontend)
 * @param jobIDs - The job ids
 * @param labels - the labels to add to the jobs
 */
export function addJobsLabels(app, jobIds: string[], labels: string[], username: string): Test {
  return request(app).put('/labels').use(auth({ username })).send({ jobID: jobIds, label: labels  });
}

/**
 * Submits a delete labels request
 *
 * @param app - The express application (typically this.frontend)
 * @param jobIDs - The job ids
 * @param labels - the labels to set delete from the jobs
 */
export function deleteJobsLabels(app, jobIds: string[], labels: string[], username: string): Test {
  return request(app).delete('/labels').use(auth({ username })).send({ jobID: jobIds, label: labels });
}