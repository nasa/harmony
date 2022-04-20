import { Response, NextFunction } from 'express';
import { Logger } from 'winston';
import HarmonyRequest from '../models/harmony-request';
import { Job, JobStatus } from '../models/job';
import WorkflowStep, { getWorkflowStepsByJobId } from '../models/workflow-steps';
import db from '../util/db';
import env = require('../util/env');
import { getPagingParams } from '../util/pagination';
import { Parser } from 'json2csv';
import { getTotalWorkItemSizeForJobID } from '../models/work-item';
import _ from 'lodash';

const fields = [
  'totalTime', 'numInputGranules', 'totalGranuleSize', 'numVariables', 'concatenate',
  'reproject', 'synchronous', 'spatialSubset', 'shapefileSubset', 'chainLength',
  'harmonyGdalAdapter', 'harmonyServiceExample', 'harmonyNetcdfToZarr', 'swotReproject',
  'varSubsetter', 'sdsMaskfill', 'trajectorySubsetter', 'podaacConcise',
  'podaacL2Subsetter', 'giovanniAdapter',
];

interface RequestMetrics {
  harmonyGdalAdapter: number;
  harmonyServiceExample: number;
  harmonyNetcdfToZarr: number;
  swotReproject: number;
  varSubsetter: number;
  sdsMaskfill: number;
  trajectorySubsetter: number;
  podaacConcise: number;
  podaacL2Subsetter: number;
  giovanniAdapter: number;
  numInputGranules: number;
  totalGranuleSize: number;
  totalTime: number;
  numVariables: number;
  concatenate: number;
  reproject: number;
  synchronous: number;
  spatialSubset: number;
  shapefileSubset: number;
  chainLength: number;
}

/**
 * Returns the service name for the given ID
 * @returns the service name matching what is used in the RequestMetrics definition
 */
function getServiceNameFromID(serviceID: string, logger: Logger): string {
  // I realize this is terrible
  let serviceName = null;
  switch (true) {
    case /harmony-gdal-adapter/.test(serviceID):
      serviceName = 'harmonyGdalAdapter';
      break;
    case /service-example/.test(serviceID):
      serviceName = 'harmonyServiceExample';
      break;
    case /netcdf-to-zarr/.test(serviceID):
      serviceName = 'harmonyNetcdfToZarr';
      break;
    case /swot-reproject/.test(serviceID):
      serviceName = 'swotReproject';
      break;
    case /variable-subsetter/.test(serviceID):
      serviceName = 'varSubsetter';
      break;
    case /maskfill-harmony/.test(serviceID):
      serviceName = 'sdsMaskfill';
      break;
    case /trajectory-subsetter/.test(serviceID):
      serviceName = 'trajectorySubsetter';
      break;
    case /podaac\/concise/.test(serviceID):
      serviceName = 'podaacConcise';
      break;
    case /podaac\/l2ss-py/.test(serviceID):
      serviceName = 'podaacL2Subsetter';
      break;
    case /giovanni-adapter/.test(serviceID):
      serviceName = 'giovanniAdapter';
      break;
    case /query\-cmr/.test(serviceID):
      break;
    default:
      logger.warn(`Service ${serviceID} is not mapped correctly`);
  }
  return serviceName;
}

/**
 * Returns a ServiceRow indicating the services used for a request
 * @param steps - the workflow steps for a request
 * @param logger - the logger associated with the request
 * @returns the ServiceRow representing the services used for a request
 */
function getServiceMetricsFromSteps(steps: WorkflowStep[], logger: Logger): Partial<RequestMetrics> {
  const row = {
    harmonyGdalAdapter: 0,
    harmonyServiceExample: 0,
    harmonyNetcdfToZarr: 0,
    swotReproject: 0,
    varSubsetter: 0,
    sdsMaskfill: 0,
    trajectorySubsetter: 0,
    podaacConcise: 0,
    podaacL2Subsetter: 0,
    giovanniAdapter: 0,
    numVariables: 0,
    concatenate: 0,
    reproject: 0,
    spatialSubset: 0,
    shapefileSubset: 0,
    chainLength: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mergedOperation: any = {};
  for (const step of steps) {
    const serviceName = getServiceNameFromID(step.serviceID, logger);
    if (row.hasOwnProperty(serviceName)) {
      row[serviceName] = 1;
    }
    mergedOperation = _.merge(mergedOperation, JSON.parse(step.operation));
  }

  row.chainLength = steps?.length || 0;
  row.numVariables = mergedOperation.sources.reduce(
    (total, s) => total + (s.variables?.length || 0),
    0);

  if (mergedOperation.concatenate) {
    row.concatenate = 1;
  }

  if (mergedOperation.format?.crs) {
    row.reproject = 1;
  }

  if (mergedOperation.subset?.bbox?.length > 0) {
    row.spatialSubset = 1;
  }

  if (mergedOperation.subset?.shape) {
    row.shapefileSubset = 1;
  }

  return row;
}

/**
 * Express.js handler that returns request metrics to be used for cost
 * estimation for a request
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns Resolves when the request is complete
 */
export default async function getRequestMetrics(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  req.context.logger.info(`Generating request metrics requested by user ${req.user}`);
  try {
    const { page, limit } = getPagingParams(req, env.defaultJobListPageSize);
    const rows = [];
    await db.transaction(async (tx) => {
      // Get all the jobs - jobs by default are returned with most recent job first
      const jobs = await Job.queryAll(tx, { where: { status: JobStatus.SUCCESSFUL } }, false, page, limit);

      for (const job of jobs.data) {
        const steps = await getWorkflowStepsByJobId(tx, job.jobID);
        const row = getServiceMetricsFromSteps(steps, req.context.logger);
        row.numInputGranules = job.numInputGranules;
        row.totalTime = (job.updatedAt.getTime() - job.createdAt.getTime()) / 1000;
        row.totalGranuleSize = await getTotalWorkItemSizeForJobID(tx, job.jobID);
        row.synchronous = 1;
        if (job.isAsync) {
          row.synchronous = 0;
        }
        rows.push(row);
      }
    });

    const json2csv = new Parser({ fields });
    const csv = json2csv.parse(rows);
    res.header('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}