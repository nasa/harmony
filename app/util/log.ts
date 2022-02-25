import * as _ from 'lodash';
import * as winston from 'winston';
import env = require('./env');

const envNameFormat = winston.format((info) => ({ ...info, env_name: env.harmonyClientId }));

/**
 * Redact sensitive keys from an object.
 * @param obj - the object to inspect
 * @param sensitiveKeys - which keys to remove
 */
function redact(obj: object, sensitiveKeys: RegExp[]): void {
  Object.keys(obj).forEach(function (key) {
    if (typeof obj[key] === 'object') {
      redact(obj[key], sensitiveKeys);
    } else {
      if (sensitiveKeys.some(regex => regex.test(key))) {
        obj[key] = '<redacted>';
      }
    }
  });
}

/**
 * Formatter to help remove sensitive values from logs.
 */
const redactor = winston.format((info) => {
  const redacted = _.cloneDeep(info);
  redact(redacted, [/token/i]);
  return redacted;
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
      redactor(),
      winston.format.json(),
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
      redactor(),
      textformat,
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
