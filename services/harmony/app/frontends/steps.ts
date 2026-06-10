import { NextFunction, Request, Response } from 'express';
import { ILengthAwarePagination } from 'knex-paginate';

import { sanitizeImage } from '@harmony/util/string';

import { createPublicPermalink } from './service-results';
import HarmonyRequest from '../models/harmony-request';
import WorkItem, {
  queryAll as queryWorkItems, workItemStatusCountsForJob,
} from '../models/work-item';
import {
  COMPLETED_WORK_ITEM_STATUSES, getStacLocation, WorkItemQuery, WorkItemStatus,
} from '../models/work-item-interface';
import WorkflowStep, { getWorkflowStepsByJobId } from '../models/workflow-steps';
import db from '../util/db';
import { isAdminUser } from '../util/edl-api';
import { RequestValidationError } from '../util/errors';
import { getJobIfAllowed } from '../util/job';
import { Link } from '../util/links';
import { keysToLowerCase } from '../util/object';
import { defaultObjectStore } from '../util/object-store';
import { getPagingLinks, parseIntegerParam } from '../util/pagination';
import { readCatalogItems, StacItem } from '../util/stac';
import { getRequestRoot } from '../util/url';

const DEFAULT_PER_PAGE = 50;
const MAX_STEP_PAGE_SIZE = 1000;
const MAX_BATCH_CATALOGS = 5;
const VALID_STATUSES = Object.values(WorkItemStatus);


interface StepsQueryParams {
  step?: number;
  status?: WorkItemStatus;
  workItem?: number;
}

interface StepWorkItem {
  id: number;
  status: WorkItemStatus;
  retryCount: number;
  inputFiles: string[] | null;
  outputFiles: string[] | null;
  warning?: string;
}

interface JobStep {
  serviceID: string;
  stepIndex: number;
  workItemCount: number;
  statuses: Partial<Record<WorkItemStatus, number>>;
  workItems: StepWorkItem[];
  paging?: StepPaging;
}

interface StepPaging {
  currentPage: number;
  lastPage: number;
  total: number;
  links: Link[];
}

/**
 * Parse the query parameters used to filter and shape the steps response.
 *
 * @param query - the raw request query string parameters
 * @returns the validated and normalized steps query
 * @throws RequestValidationError - if any parameter is not a valid value
 */
function parseQuery(query: Record<string, unknown>): StepsQueryParams {
  const out: StepsQueryParams = {};

  if (query.step !== undefined) {
    const n = Number(query.step);
    if (!Number.isInteger(n) || n < 1) {
      throw new RequestValidationError('step must be a positive integer');
    }
    out.step = n;
  }

  if (query.status !== undefined) {
    const s = String(query.status) as WorkItemStatus;
    if (!VALID_STATUSES.includes(s)) {
      throw new RequestValidationError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    out.status = s;
  }

  if (query.workitem !== undefined) {
    const n = Number(query.workitem);
    if (!Number.isInteger(n) || n < 1) {
      throw new RequestValidationError('workItem must be a positive integer');
    }
    out.workItem = n;
  }

  return out;
}

/**
 * Collect every asset href from a list of STAC items.
 *
 * @param items - the STAC items whose asset hrefs should be collected
 * @returns every asset href found across the items
 */
function getAllAssetHrefs(items: StacItem[]): string[] {
  const hrefs: string[] = [];
  for (const item of items) {
    for (const name in item.assets ?? {}) {
      const { href } = item.assets[name];
      if (href) hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Read a STAC catalog and return every asset href it references.
 *
 * @param catalogUrl - the location of the STAC catalog to read
 * @returns the asset hrefs from the catalog, or an empty array if the catalog
 *   cannot be read (e.g. the service failed before producing it, or the
 *   catalog has no assets)
 */
async function resolveDataHrefs(catalogUrl: string): Promise<string[]> {
  try {
    const items = await readCatalogItems(catalogUrl);
    return getAllAssetHrefs(items);
  } catch {
    return [];
  }
}

// Placeholder used in inputFiles / outputFiles when a STAC asset href cannot
// be turned into a public/valid link.
const PRIVATE_FILE_PLACEHOLDER = '<private file location>';

/**
 * Convert a raw STAC asset href into the public-facing form.
 * S3 URLs under `.../public/` become `<frontendRoot>/service-results/...`
 * HTTPS URLs pass through.
 * User provided S3:// urls are returned for allowed locations.
 *
 * @param href - the raw STAC asset href to convert
 * @param frontendRoot - The root URL to use when producing Harmony permalinks
 * @param destinationBucket - the job's destinationUrl bucket name, or undefined
 *     if the job has no destinationUrl
 * @returns the Harmony permalink result for a signable href; the raw href if it is in
 *   the job's destination bucket; otherwise the PRIVATE_FILE_PLACEHOLDER sentinel
 */
export function safePublicLink(href: string, frontendRoot: string, destinationBucket: string | undefined): string {
  try {
    return createPublicPermalink(href, frontendRoot);
  } catch {
    if (destinationBucket && href.startsWith(`s3://${destinationBucket}/`)) {
      return href;
    }
    return PRIVATE_FILE_PLACEHOLDER;
  }
}

// Per-WI output catalog list, plus how many additional catalog files (if any)
// were dropped to keep the S3 fan-out bounded.
interface WiOutputCatalogs {
  urls: string[];
  omittedCount: number;
}

interface ResolvedCatalogs {
  // Map of local catalog.json location -> Array of public links to file.
  catalogHrefs: Map<string, string[]>;
  // Map of work item id to its output catalog.json list (plus the omitted count).
  wiOutputCatalogs: Map<number, WiOutputCatalogs>;
}

/**
 * Sorting function to return the catalogs in the order they are presumed to be
 * generated.
 *
 * @param filename - a `catalog.json` / `catalogN.json` basename
 * @returns the numeric index, or -1 if the filename has none
 */
function catalogIndex(filename: string): number {
  const m = filename.match(/catalog(\d+)\.json$/);
  return m ? Number(m[1]) : -1;
}

/**
 * Determine a completed work item's output catalog file URLs, mirroring
 * service-runner's `_getStacCatalogs` discovery so that every catalog a service
 * writes is found:
 *   - if the work item wrote a `batch-catalogs.json` (query-cmr, and aggregating
 *     services such as batchee/stitchee), use the catalogN.json files it lists;
 *   - otherwise list the `catalog*.json` files in the outputs directory, which
 *     covers both the common single `catalog.json` and services that might write
 *     several `catalogN.json` files without an index.
 * The result is capped at MAX_BATCH_CATALOGS to bound the downstream S3 reads;
 * any extras are reported as omittedCount.
 *
 * @param outputDir - the WI's outputs directory URL
 * @returns the (capped) catalog URLs and the count of additional catalog
 *   files that were not included
 */
async function readOutputCatalogs(outputDir: string): Promise<WiOutputCatalogs> {
  const store = defaultObjectStore();
  const batchCatalogsUrl = `${outputDir}batch-catalogs.json`;

  let filenames: string[];
  if (await store.objectExists(batchCatalogsUrl)) {
    try {
      filenames = await store.getObjectJson(batchCatalogsUrl) as string[];
    } catch {
      return { urls: [], omittedCount: 0 };
    }
  } else {
    const keys = await store.listObjectKeys(outputDir);
    filenames = keys
      .map((k) => k.split('/').pop())
      .filter((f) => /^catalog\d*\.json$/.test(f))
      .sort((a, b) => catalogIndex(a) - catalogIndex(b));
  }

  const capped = filenames.slice(0, MAX_BATCH_CATALOGS);
  return {
    urls: capped.map((f) => `${outputDir}${f}`),
    omittedCount: Math.max(0, filenames.length - MAX_BATCH_CATALOGS),
  };
}

/**
 * For every completed work item, determine its output catalog file URLs, then
 * resolve each unique catalog URL (inputs + outputs) to public-facing data
 * hrefs.
 *
 * @param workItems - the page of work items whose catalogs should be resolved
 * @param frontendRoot - the root URL to use when producing Harmony permalinks
 * @returns the per-catalog to  hrefs map and per-WI output to catalog list (see
 *   ResolvedCatalogs)
 */
async function resolveAllCatalogs(
  workItems: WorkItem[],
  frontendRoot: string,
  destinationBucket: string = undefined,
): Promise<ResolvedCatalogs> {
  const completed_workitems = workItems.filter((wi) => COMPLETED_WORK_ITEM_STATUSES.includes(wi.status));

  // Determine each completed WI's *output* catalog file URLs
  const wiOutputCatalogs = new Map<number, WiOutputCatalogs>();
  await Promise.all(completed_workitems.map(async (wi) => {
    const outputDir = getStacLocation({ id: wi.id, jobID: wi.jobID });
    wiOutputCatalogs.set(wi.id, await readOutputCatalogs(outputDir));
  }));

  // Collect every unique catalog file URL: each completed WI's
  // input (stacCatalogLocation) plus every output catalog file.
  const allCatalogUrls = new Set<string>();
  for (const wi of completed_workitems) {
    if (wi.stacCatalogLocation) allCatalogUrls.add(wi.stacCatalogLocation);
    for (const url of wiOutputCatalogs.get(wi.id)?.urls ?? []) allCatalogUrls.add(url);
  }

  const catalogHrefs = new Map<string, string[]>();
  await Promise.all(Array.from(allCatalogUrls).map(async (url) => {
    const rawHrefs = await resolveDataHrefs(url);
    catalogHrefs.set(url, rawHrefs.map((h) => safePublicLink(h, frontendRoot, destinationBucket)));
  }));

  return { catalogHrefs, wiOutputCatalogs };
}

/**
 * Build the work item portion of the response. inputFiles / outputFiles are
 * populated from the precomputed `resolved` maps; a WI absent from
 * `wiOutputCatalogs` displays `outputFiles: null`. WIs that never have a STAC
 * input (e.g.  query-cmr step 1) always report `inputFiles: null`.
 *
 * @param wi - the work item to serialize
 * @param resolved - the catalog hrefs map + per-WI output catalog list
 * @returns the work item shaped for the steps response
 */
function buildWorkItem(
  wi: WorkItem,
  resolved: ResolvedCatalogs,
): StepWorkItem {
  const { catalogHrefs, wiOutputCatalogs } = resolved;
  const outputCatalogs = wiOutputCatalogs.get(wi.id);
  let outputFiles: string[] | null;
  let truncationWarning: string | undefined = undefined;
  if (outputCatalogs === undefined) {
    outputFiles = null;
  } else {
    outputFiles = outputCatalogs.urls.flatMap((url) => catalogHrefs.get(url) ?? []);
    if (outputCatalogs.omittedCount > 0) {
      truncationWarning = 'Not all output files are included. Only the outputs from the first ' +
        `${outputCatalogs.urls.length} STAC catalogs were resolved, there are ${outputCatalogs.omittedCount} catalogs that were not resolved.`;
    }
  }

  return {
    id: wi.id,
    status: wi.status,
    retryCount: wi.retryCount,
    inputFiles: wi.stacCatalogLocation
      ? (catalogHrefs.get(wi.stacCatalogLocation) ?? null)
      : null,
    outputFiles,
    ...(truncationWarning !== undefined && { warning: truncationWarning }),
  };
}


// A workflow step, its page of work items and the pagination info.
interface StepWorkItems {
  step: WorkflowStep;
  workItems: WorkItem[];
  pagination: ILengthAwarePagination;
}

/**
 * Build the full step list from each step's requested page of work items.
 * A step with more than one page of matching work items gets a `paging` block
 * whose links page that step via its own `step<stepIndex>Page` query parameter.
 * When a status/workItem filter is active, steps with no matching work items are
 * omitted unless they are missing because the page is invalid page.
 *
 * @param req - the Express request, used to build per-step paging links
 * @param stepResults - each workflow step with its page of work items and pagination
 * @param resolved - resolved-catalog data from resolveAllCatalogs
 * @param statusCounts - per-step, per-status work item counts for the whole job
 * @param q - the parsed steps query, used to honor the status/workItem filters
 * @returns the steps with their work items, status summary, and any paging links
 */
function buildSteps(
  req: Request,
  stepResults: StepWorkItems[],
  resolved: ResolvedCatalogs,
  statusCounts: Map<number, Partial<Record<WorkItemStatus, number>>>,
  q: StepsQueryParams,
): JobStep[] {
  const result: JobStep[] = [];
  const filtering = q.status !== undefined || q.workItem !== undefined;
  for (const { step, workItems, pagination } of stepResults) {
    // Don't show steps having no matching work items.
    if (filtering && pagination.total === 0) continue;

    const jobStep: JobStep = {
      serviceID: sanitizeImage(step.serviceID),
      stepIndex: step.stepIndex,
      workItemCount: step.workItemCount,
      statuses: statusCounts.get(step.stepIndex) ?? {},
      workItems: workItems.map((wi) => buildWorkItem(wi, resolved)),
    };
    const { currentPage, lastPage, total } = pagination;
    if (lastPage > 1 || currentPage > Math.max(lastPage, 1)) {
      jobStep.paging = {
        currentPage,
        lastPage,
        total,
        links: getPagingLinks(req, pagination, true, `step${step.stepIndex}page`),
      };
    }

    result.push(jobStep);
  }

  return result;
}

/**
 * Express.js handler for GET /jobs/:jobID/steps. Returns a JSON document
 * describing the job, its workflow steps, and the inputs/outputs of those
 * steps.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export async function getJobSteps(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  const { jobID } = req.params;
  try {
    req.query = keysToLowerCase(req.query);
    const q = parseQuery(req.query as Record<string, unknown>);

    const isAdmin = await isAdminUser(req);
    const job = await getJobIfAllowed(jobID, req.user, isAdmin, req.accessToken, true);
    const destinationBucket = job.destination_url?.substring(5).split('/')[0];

    const steps = await getWorkflowStepsByJobId(db, jobID);
    const statusCounts = await workItemStatusCountsForJob(db, jobID);

    const selectedSteps = q.step !== undefined
      ? steps.filter((s) => s.stepIndex === q.step)
      : steps;

    // Bound every page result by 'limit' and page each step independently
    // via step<stepIndex>Page parameter.
    const limit = parseIntegerParam(req, 'limit', DEFAULT_PER_PAGE, 1, MAX_STEP_PAGE_SIZE, true, true);
    const stepResults: StepWorkItems[] = await Promise.all(selectedSteps.map(async (step) => {
      const where: WorkItemQuery['where'] = { jobID, workflowStepIndex: step.stepIndex };
      if (q.status !== undefined) where.status = q.status;
      if (q.workItem !== undefined) where.id = q.workItem;
      const page = parseIntegerParam(req, `step${step.stepIndex}page`, 1, 1, null, false, true);
      const { workItems, pagination } = await queryWorkItems(
        db, { where, orderBy: { field: 'id', value: 'asc' } }, page, limit,
      );
      return { step, workItems, pagination };
    }));

    const frontendRoot = getRequestRoot(req);
    const allWorkItems = stepResults.flatMap((r) => r.workItems);
    const resolvedCatalogs = await resolveAllCatalogs(allWorkItems, frontendRoot, destinationBucket);
    const jobSteps = buildSteps(req, stepResults, resolvedCatalogs, statusCounts, q);

    const responseBody = {
      jobID: job.jobID,
      serviceName: job.service_name,
      status: job.status,
      progress: job.progress,
      message: job.message,
      username: job.username,
      numInputGranules: job.numInputGranules,
      request: job.request,
      steps: jobSteps,
    };

    res.json(responseBody);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}
