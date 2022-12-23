import { Response, NextFunction } from 'express';
import { sanitizeImage } from '../util/string';
import { getJobIfAllowed } from '../util/job';
import { Job, JobStatus, JobQuery } from '../models/job';
import { getWorkItemById, queryAll } from '../models/work-item';
import { ForbiddenError, NotFoundError, RequestValidationError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import version from '../util/version';
import env = require('../util/env');
import { keysToLowerCase } from '../util/object';
import { getItemLogsLocation, WorkItemQuery, WorkItemStatus } from '../models/work-item-interface';
import { getRequestRoot } from '../util/url';
import { belongsToGroup } from '../util/cmr';
import { getAllStateChangeLinks, getJobStateChangeLinks } from '../util/links';
import { objectStoreForProtocol } from '../util/object-store';
import { handleWorkItemUpdate } from '../backends/workflow-orchestration';
import { Logger } from 'winston';

/**
 * Maps job status to display class.
 */
const statusClass = {
  [JobStatus.ACCEPTED]: 'primary',
  [JobStatus.CANCELED]: 'secondary',
  [JobStatus.FAILED]: 'danger',
  [JobStatus.SUCCESSFUL]: 'success',
  [JobStatus.RUNNING]: 'info',
  [JobStatus.PAUSED]: 'warning',
  [JobStatus.PREVIEWING]: 'info',
  [JobStatus.COMPLETE_WITH_ERRORS]: 'success',
  [JobStatus.RUNNING_WITH_ERRORS]: 'warning',
};

/**
 * Defines values that have been parsed and transformed
 * from the query string of a GET request for jobs or work item(s). 
 */
interface TableQuery {
  sortGranules: string,
  statusValues: string[],
  userValues: string[],
  from: Date,
  to: Date,
  dateKind: 'createdAt' | 'updatedAt',
  allowStatuses: boolean,
  allowUsers: boolean,
}

/**
 * Return an object that contains key value entries for jobs or work items table filters.
 * @param requestQuery - the Record given by keysToLowerCase
 * @param isAdminAccess - is the requesting user an admin and requesting from an admin route (determines
 * whether they should be allowed to filter by username)
 * @param statusEnum - which status (e.g. JobStatus, WorkItemStatus) to validate accepted form values against
 * @param maxFilters - set a limit on the number of user requested filters
 * @returns object containing filter values
 */
function parseQuery( /* eslint-disable @typescript-eslint/no-explicit-any */
  requestQuery: Record<string, any>,
  statusEnum: any,
  isAdminAccess = false,
  maxFilters = 30,
): { tableQuery: TableQuery, originalValues: string } {
  const tableQuery: TableQuery = {
    sortGranules: undefined,
    // tag input
    statusValues: [],
    userValues: [],
    allowStatuses: true,
    allowUsers: true,
    // date controls
    from: undefined,
    to: undefined,
    dateKind: 'createdAt',
  };
  let originalValues = '[]';
  tableQuery.sortGranules = requestQuery.sortgranules;
  tableQuery.allowStatuses = !(requestQuery.disallowstatus === 'on');
  tableQuery.allowUsers = !(requestQuery.disallowuser === 'on');
  if (requestQuery.tablefilter) {
    const selectedOptions: { field: string, dbValue: string, value: string }[] = JSON.parse(requestQuery.tablefilter);
    const validStatusSelections = selectedOptions
      .filter(option => option.field === 'status' && Object.values<string>(statusEnum).includes(option.dbValue));
    const statusValues = validStatusSelections.map(option => option.dbValue);
    const validUserSelections = selectedOptions
      .filter(option => isAdminAccess && /^user: [A-Za-z0-9\.\_]{4,30}$/.test(option.value));
    const userValues = validUserSelections.map(option => option.value.split('user: ')[1]);
    if ((statusValues.length + userValues.length) > maxFilters) {
      throw new RequestValidationError(`Maximum amount of filters (${maxFilters}) was exceeded.`);
    }
    originalValues = JSON.stringify(validStatusSelections
      .concat(validUserSelections));
    tableQuery.statusValues = statusValues;
    tableQuery.userValues = userValues;
  }
  tableQuery.dateKind = requestQuery.datekind || 'createdAt';
  // everything in the Workflow UI uses the browser timezone, so we need a timezone offset
  const offSetMs = parseInt(requestQuery.tzoffsetminutes) * 60 * 1000;
  const utcDateTime = (yearMonthDayHoursMinutes: string): string => `${yearMonthDayHoursMinutes}:00.000Z`;
  if (requestQuery.fromdatetime) {
    const dateTimeMs = Date.parse(utcDateTime(requestQuery.fromdatetime));
    tableQuery.from = new Date(dateTimeMs + offSetMs);
  }
  if (requestQuery.todatetime) {
    const dateTimeMs = Date.parse(utcDateTime(requestQuery.todatetime));
    tableQuery.to = new Date(dateTimeMs + offSetMs);
  }
  console.log(tableQuery);
  return { tableQuery, originalValues };
}

/**
 * Returns an object with all of the functions necessary for rendering
 * a row of the jobs table.
 * @param logger - the logger to use
 * @param requestQuery - the query parameters from the request
 * @returns an object with rendering functions
 */
function jobRenderingFunctions(logger: Logger, requestQuery: Record<string, any>): object {
  return {
    jobBadge(): string {
      return statusClass[this.status];
    },
    jobCreatedAt(): number { return this.createdAt.getTime(); },
    jobUrl(): string {
      try {
        const url = new URL(this.request);
        const path = url.pathname + url.search;
        return path;
      } catch (e) {
        logger.error(`Could not form a valid URL from job.request: ${this.request}`);
        logger.error(e);
        return this.request;
      }
    },
    sortGranulesLinks(): string {
      // return links that lets the user apply or unapply an asc or desc sort
      const [ asc, desc ] = [ 'asc', 'desc' ].map((sortValue) => {
        const isSorted = requestQuery.sortgranules === sortValue;
        const colorClass = isSorted ? 'link-dark' : '';
        const title = `${isSorted ? 'un' : ''}apply ${sortValue === 'asc' ? 'ascending' : 'descending'} sort`;
        const sortGranulesValue = !isSorted ? sortValue : '';
        return { sortGranulesValue, colorClass, title };
      });
      // onclick, set a hidden form value that represents the current sort value, then submit the form
      const setValueStr = "document.getElementById('sort-granules').value";
      const submitFormStr = "document.getElementById('jobs-query-form').submit()";
      return `<a href="#" onclick="${setValueStr}='${asc.sortGranulesValue}';${submitFormStr};" class="${asc.colorClass}" style="height:12px;">
        <i class="bi bi-caret-up-fill" title="${asc.title}"></i>
      </a>
      <a href="#" onclick="${setValueStr}='${desc.sortGranulesValue}';${submitFormStr};" class="${desc.colorClass}">
        <i class="bi bi-caret-down-fill" title="${desc.title}"></i>
      </a>`;
    },
    linkDisabled(): string { return (this.href ? '' : 'disabled'); },
    linkHref(): string { return (this.href || ''); },
  };
}

/**
 * Transform a TableQuery to a WorkItem db query.
 * @param tableQuery - the constraints parsed from the query string of the request
 * @param isAdmin - is the requesting user an admin
 * @param user - the requesting user's username
 * @returns JobQuery
 */
function tableQueryToJobQuery(tableQuery: TableQuery, isAdmin: boolean, user: string): JobQuery {
  const jobQuery: JobQuery = { where: {}, whereIn: {} };
  if (tableQuery.sortGranules) {
    jobQuery.orderBy = {
      field: 'numInputGranules',
      value: tableQuery.sortGranules,
    };
  }
  if (!isAdmin) {
    jobQuery.where.username = user;
  }
  if (tableQuery.statusValues.length) {
    jobQuery.whereIn.status = {
      values: tableQuery.statusValues,
      in: tableQuery.allowStatuses,
    };
  }
  if (tableQuery.userValues.length) {
    jobQuery.whereIn.username = {
      values: tableQuery.userValues,
      in: tableQuery.allowUsers,
    };
  }
  if (tableQuery.from || tableQuery.to) {
    jobQuery.dates = { field: tableQuery.dateKind };
    jobQuery.dates.from = tableQuery.from;
    jobQuery.dates.to = tableQuery.to;
  }
  return jobQuery;
}

/**
 * Display jobs along with their status in the workflow UI.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns HTML page of clickable jobs which take the user to a
 * page where they can visualize the whole workflow as it happens
 */
export async function getJobs(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const isAdminRoute = req.context.isAdminAccess;
    const requestQuery = keysToLowerCase(req.query);
    const fromDateTime = requestQuery.fromdatetime;
    const toDateTime = requestQuery.todatetime;
    const dateKind = requestQuery.datekind || 'createdAt';
    const { tableQuery, originalValues } = parseQuery(requestQuery, JobStatus, isAdminRoute);
    const jobQuery = tableQueryToJobQuery(tableQuery, isAdminRoute, req.user);
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize, true);
    const { data: jobs, pagination } = await Job.queryAll(db, jobQuery, false, page, limit);
    setPagingHeaders(res, pagination);
    const pageLinks = getPagingLinks(req, pagination);
    const firstPage = pageLinks.find((l) => l.rel === 'first');
    const lastPage = pageLinks.find((l) => l.rel === 'last');
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    res.render('workflow-ui/jobs/index', {
      version,
      page,
      limit,
      currentUser: req.user,
      isAdminRoute,
      jobs,
      sortGranules: requestQuery.sortgranules,
      disallowStatusChecked: !tableQuery.allowStatuses ? 'checked' : '',
      disallowUserChecked: !tableQuery.allowUsers ? 'checked' : '',
      toDateTime,
      fromDateTime,
      updatedAtChecked: dateKind == 'updatedAt' ? 'checked' : '',
      createdAtChecked: dateKind == 'createdAt' ? 'checked' : '',
      selectedFilters: originalValues,
      links: [
        { ...firstPage, linkTitle: 'first' },
        { ...previousPage, linkTitle: 'previous' },
        { ...nextPage, linkTitle: 'next' },
        { ...lastPage, linkTitle: 'last' },
      ],
      ...jobRenderingFunctions(req.context.logger, requestQuery),
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Display a job's progress and work items in the workflow UI.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The workflow UI page where the user can visualize the job as it progresses
 */
export async function getJob(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    const { page, limit } = getPagingParams(req, 1000);
    const requestQuery = keysToLowerCase(req.query);
    const fromDateTime = requestQuery.fromdatetime;
    const toDateTime = requestQuery.todatetime;
    const dateKind = requestQuery.datekind;
    const { originalValues } = parseQuery(requestQuery, WorkItemStatus);
    res.render('workflow-ui/job/index', {
      job,
      page,
      limit,
      toDateTime,
      fromDateTime,
      updatedAtChecked: dateKind == 'updatedAt' ? 'checked' : '',
      createdAtChecked: dateKind == 'createdAt' ? 'checked' : '',
      disallowStatusChecked: requestQuery.disallowstatus === 'on' ? 'checked' : '',
      selectedFilters: originalValues,
      version,
      isAdminRoute: req.context.isAdminAccess,
      isAdminOrOwner: job.belongsToOrIsAdmin(req.user, isAdmin),
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Return job state change links so that the user can pause, resume, cancel, etc., a job.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function getJobLinks(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  const { all } = req.query;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, false);
    const urlRoot = getRequestRoot(req);
    const links = all === 'true' ?
      getAllStateChangeLinks(job, urlRoot, isAdmin) :
      getJobStateChangeLinks(job, urlRoot, isAdmin);
    res.send(links);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Returns an object with all of the functions necessary for rendering
 * a row of the work items table.
 * @param job - the job associated with the work item
 * @param isAdmin - whether the user making the request is an admin
 * @param requestUser - the user making the request
 * @returns an object with rendering functions
 */
function workItemRenderingFunctions(job: Job, isAdmin: boolean, requestUser: string): object {
  const badgeClasses = {};
  badgeClasses[WorkItemStatus.READY] = 'primary';
  badgeClasses[WorkItemStatus.CANCELED] = 'secondary';
  badgeClasses[WorkItemStatus.FAILED] = 'danger';
  badgeClasses[WorkItemStatus.SUCCESSFUL] = 'success';
  badgeClasses[WorkItemStatus.RUNNING] = 'info';
  return {
    workflowItemBadge(): string { return badgeClasses[this.status]; },
    workflowItemStep(): string { return sanitizeImage(this.serviceID); },
    workflowItemCreatedAt(): string { return this.createdAt.getTime(); },
    workflowItemUpdatedAt(): string { return this.updatedAt.getTime(); },
    workflowItemLogsButton(): string {
      if (!isAdmin) return '';
      let logsLinks = '';
      const isComplete = [WorkItemStatus.FAILED, WorkItemStatus.SUCCESSFUL].indexOf(this.status) > -1;
      const isLogAvailable = (isComplete || this.retryCount > 0) && !this.serviceID.includes('query-cmr');
      if (isLogAvailable) {
        const logsUrl = `/admin/workflow-ui/${job.jobID}/${this.id}/logs`;
        logsLinks += `<a type="button" target="__blank" class="btn btn-sm btn-outline-primary logs-s3" href="${logsUrl}"` +
          ` title="View all service log output for work item ${this.id} in aggregate."><i class="bi bi-body-text"></i></a>&nbsp;`;
      }
      const from = this.createdAt.toISOString();
      const to = this.status === WorkItemStatus.RUNNING ? 'now' : this.updatedAt.toISOString();
      const metricsUrl = `${env.metricsEndpoint}?_g=(filters:!(),refreshInterval:(pause:!t,value:0),` +
        `time:(from:'${from}',to:'${to}'))` +
        `&_a=(columns:!(),filters:!(),index:${env.metricsIndex},interval:auto,` +
        `query:(language:kuery,query:'${encodeURIComponent(`workItemId: ${this.id}`)}'),` +
        "sort:!(!('@timestamp',desc)))";
      logsLinks += `<a type="button" target="__blank" class="btn btn-sm btn-outline-dark logs-metrics" href="${metricsUrl}"` +
      ` title="View all logs for work item ${this.id} in the Earthdata Metrics logs dashboard."><i class="bi bi-window"></i></a>`;
      return logsLinks;
    },
    workflowItemRetryButton(): string {
      const isRunning = WorkItemStatus.RUNNING === this.status;
      const noRetriesLeft = this.retryCount >= env.workItemRetryLimit;
      if (!isRunning || !job.belongsToOrIsAdmin(requestUser, isAdmin) || noRetriesLeft) return '';
      const retryUrl = `/workflow-ui/${job.jobID}/${this.id}/retry`;
      return `<button type="button" class="btn btn-light btn-sm retry-button" data-retry-url="${retryUrl}"` +
        `data-work-item-id="${this.id}" title="retry this item"><i class="bi bi-arrow-clockwise"></i></button>`;
    },
  };
}

/**
 * Transform a TableQuery to a WorkItem db query.
 * @param tableFilter - the constraints parsed from the query string of the request
 * @param jobID - the job that these work items fall under
 * @param id - the id of a particular work item to fetch (optional)
 * @returns WorkItemQuery
 */
function tableQueryToWorkItemQuery(tableFilter: TableQuery, jobID: string, id?: number): WorkItemQuery {
  const itemQuery: WorkItemQuery = { where: { jobID }, whereIn: {}, orderBy: { field: 'id', value: 'asc' } };
  if (id) {
    itemQuery.where.id = id;
  }
  if (tableFilter.statusValues.length) {
    itemQuery.whereIn.status = {
      values: tableFilter.statusValues,
      in: tableFilter.allowStatuses,
    };
  }
  if (tableFilter.from || tableFilter.to) {
    itemQuery.dates = { field: tableFilter.dateKind };
    itemQuery.dates.from = tableFilter.from;
    itemQuery.dates.to = tableFilter.to;
  }
  return itemQuery;
}

/**
 * Render the work items table for the workflow UI.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The work items table HTML
 */
export async function getWorkItemsTable(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  const { checkJobStatus } = req.query;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    if (([JobStatus.SUCCESSFUL, JobStatus.CANCELED, JobStatus.FAILED, JobStatus.COMPLETE_WITH_ERRORS]
      .indexOf(job.status) > -1) && checkJobStatus === 'true') {
      // tell the client that the job has finished
      res.status(204).json({ status: job.status });
      return;
    }
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize);
    const requestQuery = keysToLowerCase(req.query);
    const { tableQuery } = parseQuery(requestQuery, WorkItemStatus);
    const itemQuery = tableQueryToWorkItemQuery(tableQuery, jobID);
    const { workItems, pagination } = await queryAll(db, itemQuery, page, limit);
    const pageLinks = getPagingLinks(req, pagination);
    const firstPage = pageLinks.find((l) => l.rel === 'first');
    const lastPage = pageLinks.find((l) => l.rel === 'last');
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    setPagingHeaders(res, pagination);
    res.render('workflow-ui/job/work-items-table', {
      isAdmin,
      canShowRetryColumn: job.belongsToOrIsAdmin(req.user, isAdmin),
      job,
      statusClass: statusClass[job.status],
      workItems,
      ...workItemRenderingFunctions(job, isAdmin, req.user),
      links: [
        { ...firstPage, linkTitle: 'first' },
        { ...previousPage, linkTitle: 'previous' },
        { ...nextPage, linkTitle: 'next' },
        { ...lastPage, linkTitle: 'last' },
      ],
      linkDisabled() { return (this.href ? '' : 'disabled'); },
      linkHref() {
        return (this.href ? this.href
          .replace('/work-items', '')
          .replace(/(&|\?)checkJobStatus=(true|false)/, '') : '');
      },
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Render a single row of the work items table for the workflow UI.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The work items table row HTML
 */
export async function getWorkItemTableRow(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID, id } = req.params;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    // even though we only want one row/item we should still respect the current user's table filters
    const requestQuery = keysToLowerCase(req.query);
    const { tableQuery } = parseQuery(requestQuery, WorkItemStatus);
    const itemQuery = tableQueryToWorkItemQuery(tableQuery, jobID, parseInt(id));
    const { workItems } = await queryAll(db, itemQuery, 1, 1);
    if (workItems.length === 0) {
      res.send('<span></span>');
      return;
    }
    res.render('workflow-ui/job/work-item-table-row', {
      isAdmin,
      canShowRetryColumn: job.belongsToOrIsAdmin(req.user, isAdmin),
      ...workItems[0],
      ...workItemRenderingFunctions(job, isAdmin, req.user),
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Get the logs for a work item.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The logs string for the work item
 */
export async function getWorkItemLogs(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { id, jobID } = req.params;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    if (!isAdmin) {
      throw new ForbiddenError();
    }
    const logPromise =  await objectStoreForProtocol('s3')
      .getObject(getItemLogsLocation({ id: parseInt(id), jobID })).promise();
    const logs = logPromise.Body.toString('utf-8');
    res.json(JSON.parse(logs));
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Requeues the work item.
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns a JSON object with a message
 */
export async function retry(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID, id } = req.params;
  try {
    const isAdmin = req.context.isAdminAccess || await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
    await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, false); // validate access to the work item's job
    const item = await getWorkItemById(db, parseInt(id));
    if (!item) {
      throw new NotFoundError(`Unable to find item ${id}`);
    }
    if (item.retryCount >= env.workItemRetryLimit) {
      res.status(200).send({ message: 'The item does not have any retries left.' });
    }
    const workItemLogger = req.context.logger.child({ workItemId: item.id });
    await handleWorkItemUpdate(
      { workItemID: item.id, status: WorkItemStatus.FAILED,
        scrollID: item.scrollID, hits: null, results: [], totalItemsSize: item.totalItemsSize,
        errorMessage: 'A user attempted to trigger a retry via the Workflow UI.' },
      null,
      workItemLogger);
    res.status(200).send({ message: 'The item was successfully requeued.' });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Middleware to redirect any requests to /workflow-ui/ or /admin/workflow-ui/ to the same endpoint
 * with the trailing slash removed.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 *
 */
export function redirectWithoutTrailingSlash(
  req: HarmonyRequest, res: Response, next: NextFunction,
): void {
  if (req.path.endsWith('workflow-ui/')) {
    const url = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + url);
  } else {
    next();
  }
}