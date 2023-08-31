/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from 'winston';

/**
 * Function to create a wrapper that logs function execution time
 * @param func - The name of the function to be executed
 * @param functionName - function name for logging
 * @param logger - logger
 */
export function logExecutionTime<T extends (...args: any[]) => any>(func: T,
  functionName: string,
  logger: Logger) {
  return (...args: Parameters<T>): ReturnType<T> => {
    const startTime = new Date().getTime();

    const result = func(...args); // Execute the wrapped function

    const endTime = new Date().getTime();
    const durationMs = endTime - startTime;
    logger.debug(`timing.${functionName}.end`, { durationMs });

    console.log(`Function ${functionName} took ${durationMs} milliseconds to execute.`);

    return result;
  };
}

/**
 * Function to create a wrapper that logs async function execution time
 * @param func - The name of the function to be executed
 * @param functionName - function name for logging
 * @param logger - logger
 */
export async function logAsyncExecutionTime<T extends (...args: any[]) => Promise<any> | any>(
  func: T,
  functionName: string,
  logger: Logger,
) {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const startTime = new Date().getTime(); // Record start time

    const result = await func(...args); // Execute the wrapped function

    const endTime = new Date().getTime(); // Record end time
    const durationMs = endTime - startTime;
    logger.debug(`timing.${functionName}.end`, { durationMs });

    console.log(`Function ${functionName} took ${durationMs} milliseconds to execute.`);

    return result;
  };
}
