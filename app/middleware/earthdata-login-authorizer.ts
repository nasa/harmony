const winston = require('winston');

module.exports = function earthdataLoginAuthorizer(req, res, next, logger = winston) {
    next();
};
