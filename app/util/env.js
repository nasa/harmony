const harmonyClientId = process.env.CLIENT_ID || 'harmony-unknown';
const logLevel = process.env.LOG_LEVEL || 'debug';
const maxSynchronousGranules = process.env.MAX_SYNCHRONOUS_GRANULES || 1;
const maxAsynchronousGranules = process.env.MAX_ASYNCHRONOUS_GRANULES || 20;
const isDevelopment = process.env.NODE_ENV === 'development';

module.exports = {
  harmonyClientId,
  logLevel,
  maxSynchronousGranules,
  maxAsynchronousGranules,
  isDevelopment,
};
