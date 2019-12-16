const harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
const logLevel = process.env.LOG_LEVEL || 'debug';

module.exports = { harmonyClientId, logLevel };
