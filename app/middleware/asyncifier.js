const winston = require('winston');

module.exports = function asyncifier(req, res, next, logger = winston) {
    next();
};