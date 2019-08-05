const winston = require('winston');

module.exports = function contentNegotiator(req, res, next, logger = winston) {
    next(); 
};