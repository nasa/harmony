import request, { Test } from 'supertest';
import _ from 'lodash';
import { hookRequest } from './hooks';

/**
 * Makes a request to view the workflow UI jobs endpoint
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
 */
export function workflowUIJobs(app, query: object = {}): Test {
  return request(app).get('/workflow-ui').query(query);
}

/**
 * Makes an admin request to view the workflow UI jobs endpoint
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
 */
export function adminWorkflowUIJobs(app, query: object = {}): Test {
  return request(app).get('/admin/workflow-ui').query(query);
}

/**
 * Makes a request to view the workflow UI job endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function workflowUIJob(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/workflow-ui/${jobID}`).query(actualQuery);
}

/**
 * Makes an admin request to view the workflow UI job endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function adminWorkflowUIJob(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/workflow-ui/${jobID}`).query(actualQuery);
}

/**
 * Makes a request to view the workflow UI work items endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function workflowUIWorkItems(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/workflow-ui/${jobID}/work-items`).query(actualQuery);
}

/**
 * Makes an admin request to view the workflow UI work items endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function adminWorkflowUIWorkItems(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/workflow-ui/${jobID}/work-items`).query(actualQuery);
}

/**
 * Makes a request to view the workflow UI work items row endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID and id (to be used as the URL params), and (optional) username.
 * e.g. \{jobID: job.jobID, id: workItemId, username: 'billy', query: \{...\}\}
 */
export function workflowUIWorkItemsRow(
  app,
  options: { jobID: string; id: number, username?: string; query?: object },
): Test {
  const { jobID, id, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/workflow-ui/${jobID}/work-items/${id}`).query(actualQuery);
}

/**
 * Makes a request to the workflow UI job rows endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes query param object (which maps query
 * param names to values), jobIDs (array of jobID), and username.
 * e.g. \{ jobIDs, username: 'billy', query: \{...\}\}
 */
export function workflowUIJobRows(
  app,
  options: { username: string; query: object, jobIDs: string[] },
): Test {
  const { jobIDs, query } = options;
  const actualQuery = query || {};
  return request(app).post('/workflow-ui/jobs').query(actualQuery).send({ jobIDs });
}

/**
 * Makes a request to the admin workflow UI job rows endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes query param object (which maps query
 * param names to values), jobIDs (array of jobID), and username.
 * e.g. \{ jobIDs, username: 'billy', query: \{...\}\}
 */
export function adminWorkflowUIJobRows(
  app,
  options: { username: string; query: object, jobIDs: string[] },
): Test {
  const { jobIDs, query } = options;
  const actualQuery = query || {};
  return request(app).post('/admin/workflow-ui/jobs').query(actualQuery).send({ jobIDs });
}

/**
 * Makes a request to view the workflow UI work items row endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes jobID and id (to be used as the URL params),
 * and (optional) username.
 * e.g. \{jobID: job.jobID, id: workItemId, username: 'billy' \}
 */
export function workflowUIWorkItemRetry(
  app,
  options: { jobID: string; id: number, username?: string; },
): Test {
  const { jobID, id } = options;
  return request(app).post(`/workflow-ui/${jobID}/${id}/retry`);
}

/**
 * Makes a request to the workflow UI job links endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function workflowUILinks(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/workflow-ui/${jobID}/links`).query(actualQuery);
}

/**
 * Makes an admin request to the workflow UI job links endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID (to be used as the URL param), and (optional) username.
 * e.g. \{jobID: job.jobID, username: 'billy', query: \{...\}\}
 */
export function adminWorkflowUILinks(
  app,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/workflow-ui/${jobID}/links`).query(actualQuery);
}

/**
 * Makes a request to the workflow UI job logs endpoint
 *
 * @param app - The express application (typically this.frontend)
 * @param options - Mapping object. Includes (optional) query param object (which maps query
 * param names to values), jobID and id (to be used as the URL params), and (optional) username.
 * e.g. \{jobID: job.jobID, id: workItemId, username: 'billy', query: \{...\}\}
 */
export function workflowUILogs(
  app,
  options: { jobID: string; id: number, username?: string; },
): Test {
  const { jobID, id } = options;
  return request(app).get(`/logs/${jobID}/${id}`);
}

export const hookWorkflowUIJobs = hookRequest.bind(this, workflowUIJobs);
export const hookAdminWorkflowUIJobs = hookRequest.bind(this, adminWorkflowUIJobs);
export const hookWorkflowUIJob = hookRequest.bind(this, workflowUIJob);
export const hookAdminWorkflowUIJob = hookRequest.bind(this, adminWorkflowUIJob);
export const hookWorkflowUIWorkItems = hookRequest.bind(this, workflowUIWorkItems);
export const hookAdminWorkflowUIWorkItems = hookRequest.bind(this, adminWorkflowUIWorkItems);
export const hookWorkflowUIWorkItemsRow = hookRequest.bind(this, workflowUIWorkItemsRow);
export const hookWorkflowUIJobRows = hookRequest.bind(this, workflowUIJobRows);
export const hookAdminWorkflowUIJobRows = hookRequest.bind(this, adminWorkflowUIJobRows);
export const hookWorkflowUIWorkItemRetry = hookRequest.bind(this, workflowUIWorkItemRetry);
export const hookWorkflowUILinks = hookRequest.bind(this, workflowUILinks);
export const hookAdminWorkflowUILinks = hookRequest.bind(this, adminWorkflowUILinks);
export const hookWorkflowUILogs = hookRequest.bind(this, workflowUILogs);