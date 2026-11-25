import * as winston from 'winston';

import env from './env';

// The same JSON/text formats as services/harmony/app/util/log.ts. That logger isn't reused here
// because importing it loads the harmony frontend's env, which needs its whole configuration.

const textFormat = winston.format.printf((info) => {
  let message = `${info.timestamp} [${info.level}]${info.component ? ` [${info.component}]` : ''}: ${info.message}`;
  if (info.stack) message += `\n${info.stack}`;
  return message;
});

const transport = new winston.transports.Console({ level: env.logLevel });

const logger = winston.createLogger({
  defaultMeta: { application: 'analytics-query', env_name: env.clientId },
  format: process.env.TEXT_LOGGER === 'true'
    ? winston.format.combine(winston.format.timestamp(), textFormat)
    : winston.format.combine(winston.format.errors({ stack: true }), winston.format.timestamp(), winston.format.json()),
  transports: [transport],
});

/**
 * Configures logs so that they are written to the file with the given name, also suppressing
 * logging to stdout if the suppressStdOut option is set to true
 * @param filename - The name of the file to write logs to
 * @param suppressStdOut - true if logs should not be written to stdout
 */
export function configureLogToFile(filename: string, suppressStdOut = false): void {
  const fileTransport = new winston.transports.File({ filename, level: env.logLevel });
  while (suppressStdOut && logger.transports.length > 0) {
    logger.remove(logger.transports[0]);
  }
  logger.add(fileTransport);
}

export default logger;
