const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');

const getLandingPage = require('./get-landing-page');
const getRequirementsClasses = require('./get-requirements-classes');
const getCoverageRangeset = require('./get-coverage-rangeset');
const postCoverageRangeset = require('./post-coverage-rangeset');
const { describeCollection, describeCollections } = require('./describe-collections');

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
      describeCollections,
      describeCollection,
      getCoverageOffering: TODO,
      getCoverageDescription: TODO,
      getCoverageDomainSet: TODO,
      getCoverageRangeType: TODO,
      getCoverageMetadata: TODO,
      getCoverageRangeset,
      postCoverageRangeset,
      getCoverageAll: TODO,
    },
  });
}

/**
 * Adds error handling appropriate to the OGC API to the given app
 * @param {express.Application} app The express application which needs error handling routes
 * @returns {void}
 */
function handleOpenApiErrors(app) {
  app.use((err, req, res, next) => {
    if (req.path.indexOf('/ogc-api-coverages/') === -1) {
      next(err);
      return;
    }
    let status = +err.status || +err.code || 500;
    if (status < 400 || status >= 600) {
      // Handle statuses out of range due to non-http error codes
      status = 500;
    }
    let message = err.message || err.toString();
    let code;
    if (err.status && err.errors) {
      // OpenAPI Validation errors;
      code = 'openapi.ValidationError';
      const messages = err.errors.map((error) => `${error.location} parameter "${error.path}" ${error.message}`);
      message = messages.join('\n\t');
    } else {
      // Harmony errors / exceptions, using their constructor name if possible
      code = `harmony.${err.constructor ? err.constructor.name : 'UnknownError'}`;
    }
    res.status(status).json({
      code,
      description: `Error: ${message}`,
    });
    if (status < 500) {
      req.context.logger.error(`[${code}] ${message}`);
    } else {
      // Make sure we get stack traces when we throw an unexpected exception
      req.context.logger.error(err);
    }
  });
}

module.exports = { addOpenApiRoutes, handleOpenApiErrors };
