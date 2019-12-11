const winston = require('winston');
const env = require('./env');

const envNameFormat = winston.format((info) => {
  // eslint-disable-next-line no-param-reassign
  info.env_name = env.harmonyClientId;
  return info;
});

/**
 * Creates a logger that logs messages in JSON format.
 *
 * @returns {Logger} The JSON Winston logger
 */
function createJsonLogger() {
  const jsonLogger = winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      envNameFormat(),
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
 * @param {string} tag The tag string to add
 * @returns {string} The input string in tag format, or the empty string if tag does not exist
 */
function optionalTag(tag) {
  return tag ? ` [${tag}]` : '';
}

const textformat = winston.format.printf(
  (info) => `${info.timestamp} [${info.level}]${optionalTag(info.application)}${optionalTag(info.requestId)}${optionalTag(info.component)}: ${info.message}`,
);

/**
 * Creates a logger that log messages as a text string. Useful when testing locally and viewing
 * logs via a terminal.
 *
 * @returns {Logger} The text string Winston logger
 */
function createTextLogger() {
  const textLogger = winston.createLogger({
    defaultMeta: {},
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.prettyPrint(),
      winston.format.colorize({ colors: { error: 'red', info: 'blue' } }),
      textformat,
    ),
    transports: [
      new winston.transports.Console({ level: env.logLevel }),
    ],
  });

  return textLogger;
}

const logger = process.env.TEXT_LOGGER === 'true' ? createTextLogger() : createJsonLogger();

module.exports = logger;
