import { Response, NextFunction } from 'express';
import { sanitizeImage, truncateString } from '@harmony/util/string';
import { getJobIfAllowed } from '../util/job';
import { Job, JobStatus, JobQuery, TEXT_LIMIT } from '../models/job';
import { getWorkItemById, queryAll } from '../models/work-item';
import { ForbiddenError, NotFoundError, RequestValidationError } from '../util/errors';
import { getPagingParams, getPagingLinks, setPagingHeaders } from '../util/pagination';
import HarmonyRequest from '../models/harmony-request';
import db from '../util/db';
import version from '../util/version';
import { version as ogcVersion } from '../frontends/ogc-coverages';
import env from '../util/env';
import { keysToLowerCase } from '../util/object';
import { getItemLogsLocation, WorkItemQuery, WorkItemStatus } from '../models/work-item-interface';
import { getRequestRoot } from '../util/url';
import { getAllStateChangeLinks, getJobStateChangeLinks } from '../util/links';
import { objectStoreForProtocol } from '../util/object-store';
import { Logger } from 'winston';
import { serviceNames } from '../models/services';
import { getEdlGroupInformation, isAdminUser } from '../util/edl-api';
import { ILengthAwarePagination } from 'knex-paginate';
import { handleWorkItemUpdateWithJobId } from '../backends/workflow-orchestration/work-item-updates';

// Default to retrieving this number of work items per page
const defaultWorkItemPageSize = 100;

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
  serviceValues: string[],
  userValues: string[],
  providerValues: string[],
  from: Date,
  to: Date,
  dateKind: 'createdAt' | 'updatedAt',
  allowStatuses: boolean,
  allowServices: boolean,
  allowUsers: boolean,
  allowProviders: boolean,
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
    serviceValues: [],
    userValues: [],
    providerValues: [],
    allowStatuses: true,
    allowServices: true,
    allowUsers: true,
    allowProviders: true,
    // date controls
    from: undefined,
    to: undefined,
    dateKind: 'createdAt',
  };
  let originalValues = '[]';
  tableQuery.sortGranules = requestQuery.sortgranules;
  if (requestQuery.tablefilter && requestQuery.tablefilter.length > 0) {
    tableQuery.allowStatuses = !(requestQuery.disallowstatus === 'on');
    tableQuery.allowServices = !(requestQuery.disallowservice === 'on');
    tableQuery.allowUsers = !(requestQuery.disallowuser === 'on');
    tableQuery.allowProviders = !(requestQuery.disallowprovider === 'on');
    const selectedOptions: { field: string, dbValue: string, value: string }[] = JSON.parse(requestQuery.tablefilter);
    const validStatusSelections = selectedOptions
      .filter(option => option.field === 'status' && Object.values<string>(statusEnum).includes(option.dbValue));
    const statusValues = validStatusSelections.map(option => option.dbValue);
    const validServiceSelections = selectedOptions
      .filter(option => option.field === 'service' && serviceNames.includes(option.dbValue));
    const serviceValues = validServiceSelections.map(option => option.dbValue);
    const validUserSelections = selectedOptions
      .filter(option => isAdminAccess && /^user: [A-Za-z0-9\.\_]{4,30}$/.test(option.value));
    const userValues = validUserSelections.map(option => option.value.split('user: ')[1]);
    const validProviderSelections = selectedOptions
      .filter(option => /^provider: [A-Za-z0-9_]{1,100}$/.test(option.value));
    const providerValues = validProviderSelections.map(option => option.value.split('provider: ')[1].toLowerCase());
    if ((statusValues.length + serviceValues.length + userValues.length + providerValues.length) > maxFilters) {
      throw new RequestValidationError(`Maximum amount of filters (${maxFilters}) was exceeded.`);
    }
    originalValues = JSON.stringify(validStatusSelections
      .concat(validServiceSelections)
      .concat(validUserSelections)
      .concat(validProviderSelections));
    tableQuery.statusValues = statusValues;
    tableQuery.serviceValues = serviceValues;
    tableQuery.userValues = userValues;
    tableQuery.providerValues = providerValues;
  }
  // everything in the Workflow UI uses the browser timezone, so we need a timezone offset
  const offSetMs = parseInt(requestQuery.tzoffsetminutes || 0) * 60 * 1000;
  const utcDateTime = (yearMonthDayHoursMinutes: string): string => `${yearMonthDayHoursMinutes}:00.000Z`;
  if (requestQuery.fromdatetime) {
    const dateTimeMs = Date.parse(utcDateTime(requestQuery.fromdatetime));
    tableQuery.from = new Date(dateTimeMs + offSetMs);
  }
  if (requestQuery.todatetime) {
    const dateTimeMs = Date.parse(utcDateTime(requestQuery.todatetime));
    tableQuery.to = new Date(dateTimeMs + offSetMs);
  }
  if (requestQuery.fromdatetime || requestQuery.todatetime) {
    tableQuery.dateKind = requestQuery.datekind || 'createdAt';
  }
  return { tableQuery, originalValues };
}

/**
 * Convert pagination object returned from the DB into an object
 * that has similar properties, but formatted for display.
 * @param pagination - pagination object returned from the DB
 * @returns pagination info for display
 */
function getPaginationDisplay(pagination: ILengthAwarePagination): { from: string, to: string, currentPage: string, lastPage: string } {
  const zeroItems = pagination.total == 0;
  const paginationDisplay = {
    from: zeroItems ? '0' : (pagination.from + 1).toLocaleString(),
    to: pagination.to.toLocaleString(), total: pagination.total.toLocaleString(),
    currentPage: pagination.currentPage.toLocaleString(), lastPage: zeroItems ? '1' : pagination.lastPage.toLocaleString(),
  };
  return paginationDisplay;
}

/**
 * Returns an object with all of the functions necessary for rendering
 * a row of the jobs table.
 * @param logger - the logger to use
 * @param requestQuery - the query parameters from the request
 * @param checked - whether the job should be selected
 * @returns an object with rendering functions
 */
function jobRenderingFunctions(logger: Logger, requestQuery: Record<string, any>, jobIDs: string[] = []): object {
  return {
    jobBadge(): string {
      return statusClass[this.status];
    },
    jobCreatedAt(): number { return this.createdAt.getTime(); },
    jobUpdatedAt(): number { return this.updatedAt.getTime(); },
    jobRequest(): string {
      try {
        return decodeURIComponent(this.request);
      } catch (e) {
        logger.error(`Could not decode URL from job.request: ${this.request}`);
        logger.error(e);
        return this.request;
      }
    },
    jobRequestIsTruncated(): boolean {
      const req = this.request;
      return req && (req.length >= TEXT_LIMIT) && req.endsWith('..');
    },
    jobRequestDisplay(): string {
      try {
        const url = new URL(this.request);
        let { pathname } = url;
        if (pathname.indexOf('ogc-api-coverages') > -1) {
          pathname = pathname.replace(`${ogcVersion}/collections`, '...');
          pathname = pathname.replace('coverage/rangeset', '...');
        }
        const path = pathname + decodeURIComponent(url.search);
        return truncateString(path, 315);
      } catch (e) {
        logger.error(`Could not form a valid URL from job.request: ${this.request}`);
        logger.error(e);
        return this.request;
      }
    },
    jobLabelsDisplay(): string {
      return this.labels.map((label) => {
        const labelText = truncateString(label, 30);
        return `<span class="badge bg-label" title="${label}">${labelText}</span>`;
      }).join(' ');
    },
    jobMessage(): string {
      if (this.message) {
        return truncateString(this.message, 100);
      }
    },
    jobSelectBox(): string {
      const checked = jobIDs.indexOf(this.jobID) > -1 ? 'checked' : '';
      if (this.hasTerminalStatus()) {
        return '';
      }
      return `<input id="select-${this.jobID}" class="select-job" type="checkbox" data-id="${this.jobID}" data-status="${this.status}" autocomplete="off" ${checked}></input>`;
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
 * Transform a TableQuery to a Job db query.
 * @param tableQuery - the constraints parsed from the query string of the request
 * @param isAdmin - is the requesting user an admin
 * @param user - the requesting user's username
 * @param jobIDs - optional list of job IDs to match on
 * @returns JobQuery
 */
function tableQueryToJobQuery(tableQuery: TableQuery, isAdmin: boolean, user: string, jobIDs?: string[]): JobQuery {
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
  if (tableQuery.statusValues.length > 0) {
    jobQuery.whereIn.status = {
      values: tableQuery.statusValues,
      in: tableQuery.allowStatuses,
    };
  }
  if (tableQuery.serviceValues.length > 0) {
    jobQuery.whereIn.service_name = {
      values: tableQuery.serviceValues,
      in: tableQuery.allowServices,
    };
  }
  if (tableQuery.userValues.length > 0) {
    jobQuery.whereIn.username = {
      values: tableQuery.userValues,
      in: tableQuery.allowUsers,
    };
  }
  if (tableQuery.providerValues.length > 0) {
    jobQuery.whereIn.provider_id = {
      values: tableQuery.providerValues,
      in: tableQuery.allowProviders,
    };
  }
  if (tableQuery.from || tableQuery.to) {
    jobQuery.dates = { field: `jobs.${tableQuery.dateKind}` };
    jobQuery.dates.from = tableQuery.from;
    jobQuery.dates.to = tableQuery.to;
  }
  if (jobIDs && jobIDs.length > 0) {
    jobQuery.whereIn.jobID = {
      values: jobIDs,
      in: true,
    };
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
    const providerIds = (await Job.getProviderIdsSnapshot(db, req.context.logger))
      .map((providerId) => providerId.toUpperCase());
    const requestQuery = keysToLowerCase(req.query);
    const fromDateTime = requestQuery.fromdatetime;
    const toDateTime = requestQuery.todatetime;
    const dateKind = requestQuery.datekind || 'createdAt';
    const { tableQuery, originalValues } = parseQuery(requestQuery, JobStatus, isAdminRoute);
    const jobQuery = tableQueryToJobQuery(tableQuery, isAdminRoute, req.user);
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize, 1, true, true);
    const { data: jobs, pagination } = await Job.queryAll(db, jobQuery, page, limit, true);
    setPagingHeaders(res, pagination);
    const pageLinks = getPagingLinks(req, pagination, true);
    const firstPage = pageLinks.find((l) => l.rel === 'first');
    const lastPage = pageLinks.find((l) => l.rel === 'last');
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    const currentPage = pageLinks.find((l) => l.rel === 'self');
    const paginationDisplay = getPaginationDisplay(pagination);
    const selectAllBox = jobs.some((j) => !j.hasTerminalStatus()) ?
      '<input id="select-jobs" type="checkbox" title="select/deselect all jobs" autocomplete="off">' : '';
    res.render('workflow-ui/jobs/index', {
      version,
      page,
      limit,
      paginationDisplay,
      currentUser: req.user,
      isAdminRoute,
      jobs,
      selectAllBox,
      serviceNames: JSON.stringify(serviceNames),
      providerIds: JSON.stringify(providerIds),
      sortGranules: requestQuery.sortgranules,
      disallowStatusChecked: !tableQuery.allowStatuses ? 'checked' : '',
      disallowServiceChecked: !tableQuery.allowServices ? 'checked' : '',
      disallowUserChecked: !tableQuery.allowUsers ? 'checked' : '',
      disallowProviderChecked: !tableQuery.allowProviders ? 'checked' : '',
      toDateTime,
      fromDateTime,
      jobLinkQuery: `?fromDateTime=${encodeURIComponent(fromDateTime || '')}&toDateTime=${encodeURIComponent(toDateTime || '')}` +
        `&dateKind=${dateKind}&tzOffsetMinutes=${requestQuery.tzoffsetminutes || ''}` +
        `&jobsLink=${encodeURIComponent(currentPage.href)}`,
      updatedAtChecked: dateKind == 'updatedAt' ? 'checked' : '',
      createdAtChecked: dateKind != 'updatedAt' ? 'checked' : '',
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
    const isAdmin = await isAdminUser(req);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    const { page, limit } = getPagingParams(req, defaultWorkItemPageSize, 1, true, true);
    const requestQuery = keysToLowerCase(req.query);
    const fromDateTime = requestQuery.fromdatetime;
    const toDateTime = requestQuery.todatetime;
    const dateKind = requestQuery.datekind || 'createdAt';
    const { originalValues } = parseQuery(requestQuery, WorkItemStatus);
    res.render('workflow-ui/job/index', {
      job,
      page,
      limit,
      toDateTime,
      fromDateTime,
      updatedAtChecked: dateKind == 'updatedAt' ? 'checked' : '',
      createdAtChecked: dateKind != 'updatedAt' ? 'checked' : '',
      disallowStatusChecked: requestQuery.disallowstatus === 'on' ? 'checked' : '',
      selectedFilters: originalValues,
      version,
      isAdminRoute: req.context.isAdminAccess,
      isAdminOrOwner: job.belongsToOrIsAdmin(req.user, isAdmin),
      jobsLink: requestQuery.jobslink || (req.context.isAdminAccess ? '/admin/workflow-ui' : '/workflow-ui'),
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
    const isAdmin = await isAdminUser(req);
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
function workItemRenderingFunctions(job: Job, isAdmin: boolean, isLogViewer: boolean, requestUser: string): object {
  const badgeClasses = {};
  badgeClasses[WorkItemStatus.READY] = 'primary';
  badgeClasses[WorkItemStatus.CANCELED] = 'secondary';
  badgeClasses[WorkItemStatus.FAILED] = 'danger';
  badgeClasses[WorkItemStatus.SUCCESSFUL] = 'success';
  badgeClasses[WorkItemStatus.RUNNING] = 'info';
  badgeClasses[WorkItemStatus.QUEUED] = 'warning';
  return {
    workflowItemBadge(): string { return badgeClasses[this.status]; },
    workflowItemStep(): string { return sanitizeImage(this.serviceID); },
    workflowItemCreatedAt(): string { return this.createdAt.getTime(); },
    workflowItemUpdatedAt(): string { return this.updatedAt.getTime(); },
    workflowItemLogsButton(): string {
      if (!isAdmin && !isLogViewer) return '';
      let logsLinks = '';
      const isComplete = [WorkItemStatus.FAILED, WorkItemStatus.SUCCESSFUL].indexOf(this.status) > -1;
      const isLogAvailable = (isComplete || this.retryCount > 0) && !this.serviceID.includes('query-cmr');
      if (isLogAvailable) {
        const logsUrl = `/logs/${job.jobID}/${this.id}`;
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
    const { isAdmin, isLogViewer } = await getEdlGroupInformation(
      req.user, req.context.logger,
    );
    const isAdminOrLogViewer = isAdmin || isLogViewer;
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    if (([JobStatus.SUCCESSFUL, JobStatus.CANCELED, JobStatus.FAILED, JobStatus.COMPLETE_WITH_ERRORS]
      .indexOf(job.status) > -1) && checkJobStatus === 'true') {
      // tell the client that the job has finished
      res.status(204).json({ status: job.status });
      return;
    }
    const { page, limit } = getPagingParams(req, defaultWorkItemPageSize, 1, true, true);
    const requestQuery = keysToLowerCase(req.query);
    const { tableQuery } = parseQuery(requestQuery, WorkItemStatus);
    const itemQuery = tableQueryToWorkItemQuery(tableQuery, jobID);
    const { workItems, pagination } = await queryAll(db, itemQuery, page, limit);
    const pageLinks = getPagingLinks(req, pagination, true);
    const firstPage = pageLinks.find((l) => l.rel === 'first');
    const lastPage = pageLinks.find((l) => l.rel === 'last');
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    const links = [
      { ...firstPage, linkTitle: 'first' },
      { ...previousPage, linkTitle: 'previous' },
      { ...nextPage, linkTitle: 'next' },
      { ...lastPage, linkTitle: 'last' },
    ];
    links.forEach(link => (link.href = link.href ? link.href
      .replace('/work-items', '')
      .replace(/(&|\?)checkJobStatus=(true|false)/, '') : ''));
    const paginationDisplay = getPaginationDisplay(pagination);
    setPagingHeaders(res, pagination);
    res.render('workflow-ui/job/work-items-table', {
      isAdminOrLogViewer,
      canShowRetryColumn: job.belongsToOrIsAdmin(req.user, isAdmin),
      paginationDisplay,
      job,
      statusClass: statusClass[job.status],
      workItems,
      ...workItemRenderingFunctions(job, isAdmin, isLogViewer, req.user),
      links,
      linkDisabled() { return (this.href ? '' : 'disabled'); },
      linkHref() {
        return this.href;
      },
      ...jobRenderingFunctions(req.context.logger, requestQuery),
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
    const { isAdmin, isLogViewer } = await getEdlGroupInformation(
      req.user, req.context.logger,
    );
    const isAdminOrLogViewer = isAdmin || isLogViewer;
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
      isAdminOrLogViewer,
      canShowRetryColumn: job.belongsToOrIsAdmin(req.user, isAdmin),
      ...workItems[0],
      ...workItemRenderingFunctions(job, isAdmin, isLogViewer, req.user),
    });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Render the jobs table for the workflow UI.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job rows HTML
 */
export async function getJobsTable(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { jobIDs } = req.body;
    const { isAdmin } = await getEdlGroupInformation(
      req.user, req.context.logger,
    );
    const requestQuery = keysToLowerCase(req.query);
    const { tableQuery } = parseQuery(requestQuery, JobStatus, req.context.isAdminAccess);
    const jobQuery = tableQueryToJobQuery(tableQuery, isAdmin, req.user);
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize, 1, true, true);
    const jobsRes = await Job.queryAll(db, jobQuery, page, limit, true);
    const jobs = jobsRes.data;
    const { pagination } = jobsRes;
    const selectAllChecked = jobs.every((j) => j.hasTerminalStatus() || (jobIDs.indexOf(j.jobID) > -1)) ? 'checked' : '';
    const selectAllBox = jobs.some((j) => !j.hasTerminalStatus()) ?
      `<input id="select-jobs" type="checkbox" title="select/deselect all jobs" autocomplete="off" ${selectAllChecked}>` : '';
    const tableContext = {
      jobs,
      selectAllBox,
      ...jobRenderingFunctions(req.context.logger, requestQuery, jobIDs),
      isAdminRoute: req.context.isAdminAccess,
    };
    const tableHtml = await new Promise<string>((resolve, reject) => req.app.render(
      'workflow-ui/jobs/jobs-table', tableContext, (err, html) => {
        if (err) {
          reject('Could not get job rows HTML');
        }
        resolve(html);
      }));
    const pageLinks = getPagingLinks(req, pagination, true);
    const firstPage = pageLinks.find((l) => l.rel === 'first');
    const lastPage = pageLinks.find((l) => l.rel === 'last');
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    const paginationDisplay = getPaginationDisplay(pagination);
    const pagingContext = {
      links: [
        { ...firstPage, linkTitle: 'first' },
        { ...previousPage, linkTitle: 'previous' },
        { ...nextPage, linkTitle: 'next' },
        { ...lastPage, linkTitle: 'last' },
      ],
      linkDisabled(): string { return (this.href ? '' : 'disabled'); },
      linkHref(): string {
        return (this.href ? this.href
          .replace('/jobs', '') : '');
      },
      paginationDisplay,
    };
    const pagingHtml = await new Promise<string>((resolve, reject) => req.app.render(
      'workflow-ui/paging', pagingContext, (err, html) => {
        if (err) {
          reject('Could not get pagination HTML');
        }
        resolve(html);
      }));
    res.send(tableHtml + pagingHtml);
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
    const { isAdmin, isLogViewer } = await getEdlGroupInformation(
      req.user, req.context.logger,
    );
    const isAdminOrLogViewer = isAdmin || isLogViewer;
    if (!isAdminOrLogViewer) {
      throw new ForbiddenError();
    }
    const logs =  await objectStoreForProtocol('s3')
      .getObjectJson(getItemLogsLocation({ id: parseInt(id), jobID }));
    res.json(logs);
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
    const isAdmin = await isAdminUser(req);
    await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, false); // validate access to the work item's job
    const item = await getWorkItemById(db, parseInt(id));
    if (!item) {
      throw new NotFoundError(`Unable to find item ${id}`);
    }
    if (item.retryCount >= env.workItemRetryLimit) {
      res.status(200).send({ message: 'The item does not have any retries left.' });
    }
    const workItemLogger = req.context.logger.child({ workItemId: item.id });
    const workItemUpdate = {
      workItemID: item.id, status: WorkItemStatus.FAILED, scrollID: item.scrollID, hits: null, results: [],
      totalItemsSize: item.totalItemsSize, errorMessage: 'A user attempted to trigger a retry via the Workflow UI.',
      workflowStepIndex: item.workflowStepIndex,
    };

    await handleWorkItemUpdateWithJobId(jobID, workItemUpdate, null, workItemLogger);

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