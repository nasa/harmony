/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from 'winston';

/**
 * Calls an async function with the given arguments, logging how long it took to run.
 * @param func - The function to call and time
 * @param functionName - function name for logging
 * @param logger - logger
 * @param args - the arguments to call func with
 * @returns the result of calling func(...args)
 */
export async function logAsyncExecutionTime<T extends (...args: any[]) => Promise<any> | any>(
  func: T,
  functionName: string,
  logger: Logger,
  ...args: Parameters<T>
): Promise<Awaited<ReturnType<T>>> {
  const startTime = new Date().getTime();

  const result = await func(...args);

  const durationMs = new Date().getTime() - startTime;
  logger.debug(`timing.${functionName}.end`, { durationMs });

  return result;
}
