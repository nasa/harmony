const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');

const { RequestValidationError } = require('../../util/errors');

const getLandingPage = require('./get-landing-page');
const getRequirementsClasses = require('./get-requirements-classes');
const getCoverageRangeset = require('./get-coverage-rangeset');

const version = '1.0.0';
const openApiRoot = path.join(__dirname, '..', '..', 'schemas', 'ogc-api-coverages', version);
const openApiPath = path.join(openApiRoot, `ogc-api-coverages-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath, 'utf-8');

/**
 * Express handler that returns a 501 error and "not yet implemented" message to the client
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 */
function TODO(req, res) {
  res.status(501);
  res.json('Not yet implemented');
}

/**
 * Express handler that returns the OpenAPI spec for a collection
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {void}
 */
function getSpecification(req, res) {
  // Defined inline because the index file deals with the YAML spec.
  res.append('Content-type', 'text/openapi+yaml;version=3.0');
  res.send(openApiContent.replace('no-default-cmr-collection', req.collectionIds.join('/')));
}

/**
 * Sets up the express application with the OpenAPI routes for OGC API - Coverages
 *
 * @param {express.Application} app The express application
 * @returns {void}
 */
function addOpenApiRoutes(app) {
  initialize({
    app,
    apiDoc: openApiContent,
    validateApiDoc: true,
    /* Note: the default way to expose an OpenAPI endpoint is to have express handle paths
     * based on a supplied directory structure. Instead we are using the operations property
     * because we want to include the paths within the OpenAPI specification itself. */
    operations: {
      getLandingPage,
      getRequirementsClasses,
      getSpecification,
      describeCollections: TODO,
      describeCollection: TODO,
      getCoverageOffering: TODO,
      getCoverageDescription: TODO,
      getCoverageDomainSet: TODO,
      getCoverageRangeType: TODO,
      getCoverageMetadata: TODO,
      getCoverageRangeset,
      getCoverageAll: TODO,
    },
  });

  // Handles returning OpenAPI errors formatted as JSON
  app.use((err, req, res, next) => {
    if (err.status && err.errors) {
      req.logger.error(`Request validation failed with the following errors: ${JSON.stringify(err.errors)}`);
      res.status(err.status).json({
        message: err.message,
        errors: err.errors,
      });
    } else if (err instanceof RequestValidationError) {
      req.logger.error(err.message);
      res.status(400).json({
        errors: [err.message],
      });
    } else {
      next(err);
    }
  });
}

module.exports = { addOpenApiRoutes };
