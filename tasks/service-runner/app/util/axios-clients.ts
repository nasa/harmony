import logger from '../../../../app/util/log';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay, isNetworkOrIdempotentRequestError } from 'axios-retry';
import Agent from 'agentkeepalive';

/**
 * Axios client and agentkeepalive HTTP agent timeout.
 */
export const axiosTimeoutMs = 30_000;

/**
 * The agentkeepalive HTTP agent used for each Axios instance.
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
  retryOffset = 0,
  maxDelayMs = Infinity,
): number {
  if (process.env.NODE_ENV === 'test') {
    retryOffset = 0;
  }
  // calculatedDelayMs ~= (2^(retryNumber + retryOffset)) * 100
  const calculatedDelayMs = exponentialDelay(retryNumber + retryOffset);
  if (calculatedDelayMs > maxDelayMs) return maxDelayMs;
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
    logger.error('Axios retry condition has been met.',
      { 'axios-retry': error?.config['axios-retry'], 'message': error.message, 'code': error.code });
    return true;
  }
  return false;
}

/**
 * Create an Axios instance with exponential backoff retry and agentkeepalive HTTP agent.
 */
export default function createAxiosClientWithRetry(
  retries = Infinity,
  maxDelayMs = Infinity,
  retryOffset = 0,
  timeout = axiosTimeoutMs,
): AxiosInstance {
  const axiosClient = axios.create({ httpAgent: keepAliveAgent, timeout });
  axiosRetry(axiosClient, {
    retryDelay: (retryNumber) => 
      calculateExponentialDelay(retryNumber, retryOffset, maxDelayMs),
    retryCondition: isRetryable,
    shouldResetTimeout: true,
    retries });
  return axiosClient;
}