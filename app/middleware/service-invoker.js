const winston = require('winston');

module.exports = function serviceInvoker(req, res, next, logger = winston) {
    next(); 
};