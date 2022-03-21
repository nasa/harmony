import logger from '../../../../app/util/log';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay, isNetworkOrIdempotentRequestError } from 'axios-retry';
import Agent from 'agentkeepalive';

/**
 * Default Axios client timeout (also used by keepAliveAgent).
 */
const axiosTimeoutMs = 30_000;

/**
 * The default HTTP agent used by createAxiosClientWithRetry.
 */
export const keepAliveAgent = new Agent({
  keepAlive: true,
  maxSockets: 1,
  maxFreeSockets: 1,
  timeout: axiosTimeoutMs });

/**
 * Error codes that may be returned by the Axios clients.
 */
enum AxiosErrorCode {
  ECONNABORTED = 'ECONNABORTED',
  ECONNRESET = 'ECONNRESET',
}

/**
 * Calculate the delay before issuing the next request.
 * @param retryNumber - number of retriex thus far
 * @returns - delay in ms
 */
function calculateExponentialDelay(
  retryNumber: number,
  exponentialOffset = 0,
  maxDelayMs = Infinity,
): number {
  if (process.env.NODE_ENV === 'test') {
    exponentialOffset = 0;
  }
  // calculatedDelayMs ~= (2^(retryNumber + exponentialOffset)) * 100
  const calculatedDelayMs = exponentialDelay(retryNumber + exponentialOffset);
  logger.debug(`Calculating backoff delay: calculatedDelayMs=${calculatedDelayMs} (retryNumber=${retryNumber}, exponentialOffset=${exponentialOffset})`);
  if (calculatedDelayMs > maxDelayMs) {
    logger.debug(`calculatedDelayMs exceeds maxDelayMs. Returning maxDelayMs (${maxDelayMs})`);
    return maxDelayMs;
  }
  return calculatedDelayMs;
}

/**
 * Determine whether the request should be retried.
 * @param error - the axios error returned by the failed request
 * @returns - boolean
 */
function isRetryable(error: AxiosError): boolean {
  if (isNetworkOrIdempotentRequestError(error) || 
    [AxiosErrorCode.ECONNABORTED.valueOf(), AxiosErrorCode.ECONNRESET.valueOf()].includes(error.code) ) {
    logger.warn('Axios retry condition has been met.',
      { 'axios-retry': error?.config['axios-retry'], 'message': error.message, 'code': error.code });
    return true;
  }
  logger.warn('Axios error is not retriable.',
    { 'axios-retry': error?.config['axios-retry'], 'message': error.message, 'code': error.code });
  return false;
}

/**
 * Create an Axios instance with exponential backoff retry and agentkeepalive HTTP agent.
 */
export default function createAxiosClientWithRetry(
  retries = Infinity,
  maxDelayMs = Infinity,
  exponentialOffset = 0,
  timeout = axiosTimeoutMs,
  httpAgent = keepAliveAgent,
  retryCondition = isRetryable,
): AxiosInstance {
  if (process.env.NODE_ENV === 'test') {
    retries = 2;
  }
  const axiosClient = axios.create({ httpAgent, timeout });
  axiosRetry(axiosClient, {
    retryDelay: (retryNumber) => 
      calculateExponentialDelay(retryNumber, exponentialOffset, maxDelayMs),
    retryCondition,
    shouldResetTimeout: true,
    retries });
  return axiosClient;
}