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
import { COMPLETED_WORK_ITEM_STATUSES, getItemLogsLocation, WorkItemQuery, WorkItemStatus } from '../models/work-item-interface';
import { getRequestRoot } from '../util/url';
import { belongsToGroup } from '../util/cmr';
import { getAllStateChangeLinks, getJobStateChangeLinks } from '../util/links';
import { objectStoreForProtocol } from '../util/object-store';
import { handleWorkItemUpdate } from '../backends/workflow-orchestration';

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
 * Return an object that contains key value entries for jobs or work items table filters.
 * @param requestQuery - the Record given by keysToLowerCase
 * @param isAdminAccess - is the requesting user an admin and requesting from an admin route (determines
 * whether they should be allowed to filter by username)
 * @param statusEnum - which status (e.g. JobStatus, WorkItemStatus) to validate accepted form values against
 * @param maxFilters - set a limit on the number of user requested filters
 * @returns object containing filter values
 */
function parseFilters( /* eslint-disable @typescript-eslint/no-explicit-any */
  requestQuery: Record<string, any>,
  statusEnum: any,
  isAdminAccess = false,
  maxFilters = 30,
): {
    statusValues: string[], // need for querying db
    userValues: string[], // need for querying db
    originalValues: string[] // needed for populating filter input
  } {
  if (!requestQuery.tablefilter) {
    return {
      statusValues: [],
      userValues: [],
      originalValues: [],
    };
  }
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
  const originalValues = validStatusSelections
    .concat(validUserSelections)
    .map(option => option.value);
  return {
    statusValues,
    userValues,
    originalValues,
  };
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
    const requestQuery = keysToLowerCase(req.query);
    const jobQuery: JobQuery = { where: {}, whereIn: {} };
    if (requestQuery.sortgranules) {
      jobQuery.orderBy = {
        field: 'numInputGranules',
        value: requestQuery.sortgranules,
      };
    }
    if (!req.context.isAdminAccess) {
      jobQuery.where.username = req.user;
    }
    const disallowStatus = requestQuery.disallowstatus === 'on';
    const disallowUser = requestQuery.disallowuser === 'on';
    const tableFilter = parseFilters(requestQuery, JobStatus, req.context.isAdminAccess);
    if (tableFilter.statusValues.length) {
      jobQuery.whereIn.status = {
        values: tableFilter.statusValues,
        in: !disallowStatus,
      };
    }
    if (tableFilter.userValues.length) {
      jobQuery.whereIn.username = {
        values: tableFilter.userValues,
        in: !disallowUser,
      };
    }
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize, true);
    const { data: jobs, pagination } = await Job.queryAll(db, jobQuery, false, page, limit);
    setPagingHeaders(res, pagination);
    const pageLinks = getPagingLinks(req, pagination);
    const nextPage = pageLinks.find((l) => l.rel === 'next');
    const previousPage = pageLinks.find((l) => l.rel === 'prev');
    res.render('workflow-ui/jobs/index', {
      version,
      page,
      limit,
      currentUser: req.user,
      isAdminRoute: req.context.isAdminAccess,
      // job table row HTML
      jobs,
      jobBadge() {
        return statusClass[this.status];
      },
      jobCreatedAt() { return this.createdAt.getTime(); },
      jobUrl() {
        try {
          const url = new URL(this.request);
          const path = url.pathname + url.search;
          return path;
        } catch (e) {
          req.context.logger.error(`Could not form a valid URL from job.request: ${this.request}`);
          req.context.logger.error(e);
          return this.request;
        }
      },
      // job table sorting
      sortGranules: requestQuery.sortgranules,
      sortGranulesLinks() {
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
      // job table filters HTML
      disallowStatusChecked: disallowStatus ? 'checked' : '',
      disallowUserChecked: disallowUser ? 'checked' : '',
      selectedFilters: tableFilter.originalValues,
      // job table paging buttons HTML
      links: [
        { ...previousPage, linkTitle: 'previous' },
        { ...nextPage, linkTitle: 'next' },
      ],
      linkDisabled() { return (this.href ? '' : 'disabled'); },
      linkHref() { return (this.href || ''); },
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
    const disallowStatus = requestQuery.disallowstatus === 'on';
    const tableFilter = parseFilters(requestQuery, WorkItemStatus);
    res.render('workflow-ui/job/index', {
      job,
      page,
      limit,
      isAdminOrOwner: job.belongsToOrIsAdmin(req.user, isAdmin),
      disallowStatusChecked: disallowStatus ? 'checked' : '',
      selectedFilters: tableFilter.originalValues,
      tableFilter: requestQuery.tablefilter,
      version,
      isAdminRoute: req.context.isAdminAccess,
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
      const isComplete = COMPLETED_WORK_ITEM_STATUSES.indexOf(this.status) > -1;
      if (!isComplete || !isAdmin || this.serviceID.includes('query-cmr')) return '';
      const logsUrl = `/admin/workflow-ui/${job.jobID}/${this.id}/logs`;
      return `<a type="button" target="__blank" class="btn btn-light btn-sm logs-button" href="${logsUrl}"` +
        ' title="view logs"><i class="bi bi-body-text"></i></a>';
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
    const tableFilter = parseFilters(requestQuery, WorkItemStatus);
    const itemQuery: WorkItemQuery = { where: { jobID }, whereIn: {}, orderBy: { field: 'id', value: 'asc' } };
    if (tableFilter.statusValues.length) {
      itemQuery.whereIn.status = {
        values: tableFilter.statusValues,
        in: !(requestQuery.disallowstatus === 'on'),
      };
    }
    const { workItems, pagination } = await queryAll(db, itemQuery, page, limit);
    const pageLinks = getPagingLinks(req, pagination);
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
        { ...previousPage, linkTitle: 'previous' },
        { ...nextPage, linkTitle: 'next' },
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
    const tableFilter = parseFilters(requestQuery, WorkItemStatus);
    const itemQuery: WorkItemQuery = { where: { id: parseInt(id) }, whereIn: {} };
    if (tableFilter.statusValues.length) {
      itemQuery.whereIn.status = {
        values: tableFilter.statusValues,
        in: !(requestQuery.disallowstatus === 'on'),
      };
    }
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
    await handleWorkItemUpdate(
      { workItemID: item.id, status: WorkItemStatus.FAILED,
        scrollID: item.scrollID, hits: null, results: [], totalGranulesSize: item.totalGranulesSize,
        errorMessage: 'A user attempted to trigger a retry via the Workflow UI.' },
      null,
      req.context.logger);
    res.status(200).send({ message: 'The item was successfully requeued.' });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}