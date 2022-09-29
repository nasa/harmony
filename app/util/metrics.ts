// Returns metrics formatted such that they are similar across projects. Do not
// modify anything in here unless all of the projects are making a change.
// See https://wiki.earthdata.nasa.gov/display/METS/Data+Schema+Collaboration+Space

import DataOperation from '../models/data-operation';
import { Job } from '../models/job';
import { isFailureStatus } from './job';

export interface BboxMetric {
  north: number;
  west: number;
  south: number;
  east: number;
  error?: string; // We will not use this field in harmony
}

export interface ParameterMetric {
  service_name: string; // We'll use the name from services.yml
  service_provider?: string; // We do not track this information
  service_id?: string; // We do not explicitly link to a single UMM-S, so do not populate
}

export interface RequestMetric {
  referrer_request_id?: string; // We do not have this information
  request_id: string;
  user_id: string;
  user_ip: string;
  rangeBeginDateTime?: string;
  rangeEndDateTime?: string;
  bbox?: BboxMetric;
  parameters: ParameterMetric;
}

export interface ProductDataMetric {
  collectionId: string; // a concatenation of shortName + ___ + versionId
  shortName: string;
  versionId: string;
  organization?: string; // We do not have this information
  product_size?: number; // This represents the total size of outputs which we do not track yet
  variables?: string[]; // An array of variable names
}

export interface SubServiceMetric {
  regridding: boolean;
  subsetting: boolean;
  formatConversion: boolean;
}

export interface JobDataMetric {
  job_id: string;
  startTime: string;
  endTime: string;
  status: string;
  sub_services: SubServiceMetric;
}

export interface ProductMetric {
  request_id: string;
  product_data: ProductDataMetric;
  job_data: JobDataMetric;
  http_response_code: number;
}

export interface ResponseMetric {
  request_id: string;
  job_ids: string[];
  http_response_code: number;
  time_completed: string;
  total_time: number; // Agreed to use seconds with decimals
  original_size: number; // Bytes that would have needed to be downloaded
  output_size?: number; // Bytes returned after transformation - not tracking yet
}

/**
 * Returns a BboxMetric if spatial subsetting was requested
 *
 * @param operation - The data operation
 *
 * @returns a BboxMetric or null
 */
function constructBboxFromOperation(operation: DataOperation): BboxMetric {
  const bbox = operation.boundingRectangle;
  if (bbox) {
    const [ west, south, east, north ] = bbox;
    return { west, south, east, north };
  }
  return null;
}

/**
 * Returns the request metric for a request
 *
 * @param operation - The data operation
 * @param serviceName - The name of the service chain used for the request
 *
 * @returns the request metric
 */
export function getRequestMetric(operation: DataOperation, serviceName: string): RequestMetric {
  const rangeBeginDateTime = operation.temporal?.start;
  const rangeEndDateTime = operation.temporal?.end;

  const metric: RequestMetric = {
    request_id: operation.requestId,
    user_ip: '',
    user_id: operation.user,
    parameters: { service_name: serviceName },
  };

  const bbox = constructBboxFromOperation(operation);

  if (bbox) {
    metric.bbox = bbox;
  }

  if (rangeBeginDateTime) {
    metric.rangeBeginDateTime = rangeBeginDateTime as string;
  }

  if (rangeEndDateTime) {
    metric.rangeEndDateTime = rangeEndDateTime as string;
  }

  return metric;
}

/**
 * Returns the product metric for a request
 *
 *  @param operation - The data operation
 *  @param job - The job associated with the request
 *
 * @returns the product metric
 */
export function getProductMetric(operation: DataOperation, job: Job)
  : ProductMetric {
  let httpResponseCode = 200;

  if (isFailureStatus(job.status)) {
    httpResponseCode = 500;
  }

  const regridding = operation.shouldReproject;
  const subsetting =
    operation.shouldVariableSubset ||
    operation.shouldShapefileSubset ||
    operation.shouldDimensionSubset ||
    operation.shouldTemporalSubset ||
    operation.shouldSpatialSubset;

  const formatConversion = !!operation.outputFormat;
  const subServices = {
    regridding,
    subsetting,
    formatConversion,
  };

  const jobData = {
    job_id: `${job.jobID}`,
    startTime: job.createdAt.toISOString(),
    endTime: job.updatedAt.toISOString(),
    status: job.status,
    sub_services: subServices,
  };

  const { sources } = operation;
  const firstSource = sources[0];

  const productData: ProductDataMetric = {
    collectionId: firstSource.shortName + '___' + firstSource.versionId,
    shortName: firstSource.shortName,
    versionId: firstSource.versionId,
  };

  if (firstSource.variables) {
    productData.variables = firstSource.variables.map((v) => v.name);
  }

  const metric = {
    request_id: operation.requestId,
    product_data: productData,
    job_data: jobData,
    http_response_code: httpResponseCode,
  };

  return metric;
}

/**
 * Returns the response metric for a request
 *
 *  @param operation - The data operation
 *  @param job - The job associated with the request
 *  @param originalSize - The sum of the sizes of all input granules for the request
 *
 * @returns Promise that resolves to the response metric for a request
 */
export async function getResponseMetric(
  operation: DataOperation, job: Job, originalSize: number,
): Promise<ResponseMetric> {
  let httpResponseCode = 200;

  if (isFailureStatus(job.status)) {
    httpResponseCode = 500;
  }

  const metric: ResponseMetric = {
    request_id: operation.requestId,
    job_ids: [`${job.jobID}`],
    http_response_code: httpResponseCode,
    time_completed: job.updatedAt.toISOString(),
    total_time: ((job.updatedAt.getTime() - job.createdAt.getTime()) / 1000),
    original_size: originalSize,
  };

  return metric;
}