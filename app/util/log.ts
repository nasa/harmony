import * as winston from 'winston';

import env = require('./env');

const envNameFormat = winston.format((info) => ({ ...info, env_name: env.harmonyClientId }));

// used to allow winston to ignore particular logs
// also used to filter express-winston logs
export const ignorePaths = ['/admin/workflow-ui/jobs/table', '/service/work'];
export const ignoreMessages = [
  'timing.frontend-request',
  'timing.backend-request',
  'Invoking middleware',
  'Completed middleware',
  'Getting work for service',
];
export const inIgnoreList = (str, ignoreList): boolean => ignoreList.some((i) => str.includes(i));

const urlAndMessageBasedFilter = winston.format((info) => {
  if (info.requestUrl
    && info.message
    && inIgnoreList(info.message, ignoreMessages)
    && inIgnoreList(info.requestUrl, ignorePaths)) {
    return false;
  }
  return info;
});

/**
 * Creates a logger that logs messages in JSON format.
 *
 * @returns The JSON Winston logger
 */
function createJsonLogger(): winston.Logger {
  const jsonLogger = winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      envNameFormat(),
      winston.format.json(),
      urlAndMessageBasedFilter(),
    ),
    transports: [
      new winston.transports.Console({ level: env.logLevel }),
    ],
  });

  return jsonLogger;
}

/**
 * Helper method that formats a string as a log tag only if it is provided
 *
 * @param tag - The tag string to add
 * @returns The input string in tag format, or the empty string if tag does not exist
 */
function optionalTag(tag: string): string {
  return tag ? ` [${tag}]` : '';
}

const textformat = winston.format.printf(
  (info) => {
    let message = `${info.timestamp} [${info.level}]${optionalTag(info.application)}${optionalTag(info.requestId)}${optionalTag(info.component)}: ${info.message}`;
    if (info.stack) message += `\n${info.stack}`;
    return message;
  },
);

/**
 * Creates a logger that log messages as a text string. Useful when testing locally and viewing
 * logs via a terminal.
 *
 * @returns The text string Winston logger
 */
function createTextLogger(): winston.Logger {
  const textLogger = winston.createLogger({
    defaultMeta: {},
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.prettyPrint(),
      winston.format.colorize({ colors: { error: 'red', info: 'blue' } }),
      textformat,
      urlAndMessageBasedFilter(),
    ),
    transports: [
      new winston.transports.Console({ level: env.logLevel }),
    ],
  });

  return textLogger;
}

const logger = process.env.TEXT_LOGGER === 'true' ? createTextLogger() : createJsonLogger();

/**
 * Configures logs so that they are written to the file with the given name, also suppressing
 * logging to stdout if the suppressStdOut option is set to true
 * @param filename - The name of the file to write logs to
 * @param suppressStdOut - true if logs should not be written to stdout
 */
export function configureLogToFile(filename: string, suppressStdOut = false): void {
  const fileTransport = new winston.transports.File({ filename });
  while (suppressStdOut && logger.transports.length > 0) {
    logger.remove(logger.transports[0]);
  }
  logger.add(fileTransport);
}

export default logger;
