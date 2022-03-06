import * as winston from 'winston';
import { Writable } from 'stream';
import { createJsonLogger, createTextLogger } from '../../app/util/log';

/**
 * Create a logger for unit testing.
 * 
 * @returns an object containing the logger 
 * and getTestLogs function for obtaining the log messages
 */
export function createLoggerForTest(logJson = true): {
  getTestLogs: () => string,
  testLogger: winston.Logger
} {
  let outputString = '';
  const getTestLogs = (): string => outputString;
  const stream = new Writable();
  stream._write = (chunk, encoding, next): void => {
    outputString += chunk.toString();
    next();
  };
  const streamTransport = new winston.transports.Stream({ stream });
  const testLogger = logJson ? createJsonLogger([streamTransport]) : createTextLogger([streamTransport]);
  
  return { getTestLogs, testLogger };
}