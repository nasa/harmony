const harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
const logLevel = process.env.LOG_LEVEL || 'debug';
const maxSynchronousGranules = process.env.MAX_SYNCHRONOUS_GRANULES || 1;

module.exports = { harmonyClientId, logLevel, maxSynchronousGranules };
