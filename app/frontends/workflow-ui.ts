import { Response, NextFunction } from 'express';
import { sanitizeImage } from '../util/string';
import { validateJobId } from '../util/job';
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
 * @param isAdminAccess - is the requesting user an admin
 * @param statusEnum - which status (e.g. JobStatus, WorkItemStatus) to validate accepted form values against
 * @param maxFilters - set a limit on the number of user requested filters
 * @returns object containing filter values
 */
function parseFilters( /* eslint-disable @typescript-eslint/no-explicit-any */
  requestQuery: Record<string, any>,
  isAdminAccess: boolean,
  statusEnum: any,
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
    const tableFilter = parseFilters(requestQuery, req.context.isAdminAccess, JobStatus);
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
    validateJobId(jobID);
    const job = await Job.byJobID(db, jobID, false);
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
    if (!(await job.canShareResultsWith(req.user, req.context.isAdminAccess, req.accessToken))) {
      throw new NotFoundError();
    }
    const { page, limit } = getPagingParams(req, 1000);
    const requestQuery = keysToLowerCase(req.query);
    const disallowStatus = requestQuery.disallowstatus === 'on';
    const tableFilter = parseFilters(requestQuery, req.context.isAdminAccess, WorkItemStatus);
    res.render('workflow-ui/job/index', {
      // most of these values will be used to poll (getWorkItemsTable)
      // for work items or set hidden form values for when
      // the user makes a request to filter the work items table
      job,
      page,
      limit,
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
    validateJobId(jobID);
    const job = await Job.byJobID(db, jobID, false);
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
    if (!(await job.canShareResultsWith(req.user, req.context.isAdminAccess, req.accessToken))) {
      throw new NotFoundError();
    }
    if (!req.context.isAdminAccess && (job.username != req.user)) {
      // if the job is shareable but this non-admin user (req.user) does not own the job,
      // they won't be able to change the job's state via the state change links
      res.send([]);
      return;
    }
    const urlRoot = getRequestRoot(req);
    const links = all === 'true' ?
      getAllStateChangeLinks(job, urlRoot, req.context.isAdminAccess) :
      getJobStateChangeLinks(job, urlRoot, req.context.isAdminAccess);
    res.send(links);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
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
  const badgeClasses = {};
  badgeClasses[WorkItemStatus.READY] = 'primary';
  badgeClasses[WorkItemStatus.CANCELED] = 'secondary';
  badgeClasses[WorkItemStatus.FAILED] = 'danger';
  badgeClasses[WorkItemStatus.SUCCESSFUL] = 'success';
  badgeClasses[WorkItemStatus.RUNNING] = 'info';
  try {
    validateJobId(jobID);
    const query: JobQuery = { where: { requestId: jobID } };
    if (!req.context.isAdminAccess) {
      query.where.username = req.user;
    }
    const { job } = await Job.byRequestId(db, jobID, 0, 0);
    if (job) {
      if (!(await job.canShareResultsWith(req.user, req.context.isAdminAccess, req.accessToken))) {
        throw new NotFoundError();
      }
      if (([JobStatus.SUCCESSFUL, JobStatus.CANCELED, JobStatus.FAILED, JobStatus.COMPLETE_WITH_ERRORS]
        .indexOf(job.status) > -1) && checkJobStatus === 'true') {
        // tell the client that the job has finished
        res.status(204).json({ status: job.status });
        return;
      }
      const { page, limit } = getPagingParams(req, env.defaultJobListPageSize);
      const requestQuery = keysToLowerCase(req.query);
      const tableFilter = parseFilters(requestQuery, req.context.isAdminAccess, WorkItemStatus);
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
      const isAdmin = await belongsToGroup(req.user, env.adminGroupId, req.accessToken);
      res.render('workflow-ui/job/work-items-table', {
        job,
        statusClass: statusClass[job.status],
        workItems,
        workflowItemBadge() { return badgeClasses[this.status]; },
        workflowItemStep() { return sanitizeImage(this.serviceID); },
        workflowItemCreatedAt() { return this.createdAt.getTime(); },
        workflowItemUpdatedAt() { return this.updatedAt.getTime(); },
        workflowItemLogsButton() {
          const isComplete = COMPLETED_WORK_ITEM_STATUSES.indexOf(this.status) > -1;
          if (!isComplete || !isAdmin || this.serviceID.includes('query-cmr')) return '';
          const logsUrl = `/admin/workflow-ui/${job.jobID}/${this.id}/logs`;
          return `<a type="button" target="__blank" class="btn btn-light btn-sm logs-button" href="${logsUrl}" title="view logs"><i class="bi bi-body-text"></i></button>`;
        },
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
    } else {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
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
 * 
 * @param req 
 * @param res 
 * @param next 
 * @returns 
 */
export async function retry(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID, id } = req.params;
  try {
    validateJobId(jobID);
    const job = await Job.byJobID(db, jobID, false);
    const item = await getWorkItemById(db, parseInt(id));
    if (!job) {
      throw new NotFoundError(`Unable to find job ${jobID}`);
    }
    if (!item) {
      throw new NotFoundError(`Unable to find item ${id}`);
    }
    if (item.retryCount >= env.workItemRetryLimit) {
      res.status(200).send({ message: 'The item does not have any retries left.' });
    }
    if (!(await job.canShareResultsWith(req.user, req.context.isAdminAccess, req.accessToken))) {
      throw new NotFoundError();
    }
    if (!req.context.isAdminAccess && (job.username != req.user)) {
      // if the job is shareable but this non-admin user (req.user) does not own the job,
      // they shouldn't be able to trigger a retry
      throw new ForbiddenError();
    }
    await handleWorkItemUpdate(
      { workItemID: item.id, status: WorkItemStatus.FAILED,
        scrollID: item.scrollID, hits: null, results: [], totalGranulesSize: item.totalGranulesSize,
        errorMessage: 'A user has attempted to trigger a retry via the user interface.' },
      this.logger);
    res.status(200).send({ message: 'The item was updated successfully and should be set to "ready" momentarily.' });
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}