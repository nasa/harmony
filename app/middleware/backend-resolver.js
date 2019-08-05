const winston = require('winston');

module.exports = function backendResolver(req, res, next, logger = winston) {
    next(); 
};