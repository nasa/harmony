import request, { Test } from 'supertest';
import { Application } from 'express';
import _ from 'lodash';
import { hookRequest } from './hooks';

/**
 * Makes a request to view the workflow UI jobs endpoint
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
 */
export function workflowUIJobs(app: Application, query: object = {}): Test {
  return request(app).get('/workflow-ui').query(query);
}

/**
 * Makes an admin request to view the workflow UI jobs endpoint
 * @param app - The express application (typically this.frontend)
 * @param query - Mapping of query param names to values
 * @returns The response
 */
export function adminWorkflowUIJobs(app: Application, query: object = {}): Test {
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
  app: Express.Application,
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
  app: Express.Application,
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
  app: Express.Application,
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
  app: Express.Application,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/workflow-ui/${jobID}/work-items`).query(actualQuery);
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
  app: Express.Application,
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
  app: Express.Application,
  options: { jobID: string; username?: string; query?: object },
): Test {
  const { jobID, query } = options;
  const actualQuery = query || {};
  return request(app).get(`/admin/workflow-ui/${jobID}/links`).query(actualQuery);
}

export const hookWorkflowUIJobs = hookRequest.bind(this, workflowUIJobs);
export const hookAdminWorkflowUIJobs = hookRequest.bind(this, adminWorkflowUIJobs);
export const hookWorkflowUIJob = hookRequest.bind(this, workflowUIJob);
export const hookAdminWorkflowUIJob = hookRequest.bind(this, adminWorkflowUIJob);
export const hookWorkflowUIWorkItems = hookRequest.bind(this, workflowUIWorkItems);
export const hookAdminWorkflowUIWorkItems = hookRequest.bind(this, adminWorkflowUIWorkItems);
export const hookWorkflowUILinks = hookRequest.bind(this, workflowUILinks);
export const hookAdminWorkflowUILinks = hookRequest.bind(this, adminWorkflowUILinks);