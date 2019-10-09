const winston = require('winston');

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
  (info) => `[${info.level}]${optionalTag(info.application)}${optionalTag(info.requestId)}${optionalTag(info.component)}: ${info.message}`,
);

const logger = winston.createLogger({
  defaultMeta: {},
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.prettyPrint(),
    winston.format.colorize({ colors: { error: 'red', info: 'blue' } }),
    textformat,
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

module.exports = logger;
