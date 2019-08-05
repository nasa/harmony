const winston = require('winston');

module.exports = function requestValidator(req, res, next, logger = winston) {
    next(); 
};