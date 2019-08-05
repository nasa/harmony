const winston = require('winston');

module.exports = function cmrGranuleLocator(req, res, next, logger = winston) {
    next(); 
};