const winston = require('winston');

async function serviceInvoker(req, res, next, logger = winston) {
  next();
};

module.exports = serviceInvoker;