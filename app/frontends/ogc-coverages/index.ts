import { initialize } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import { Application, Response } from 'express';
import getLandingPage from './get-landing-page';
import getRequirementsClasses from './get-requirements-classes';

import getCoverageRangeset from './get-coverage-rangeset';
import postCoverageRangeset from './post-coverage-rangeset';

import { describeCollection, describeCollections } from './describe-collections';
import HarmonyRequest from '../../models/harmony-request';

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
function TODO(req: HarmonyRequest, res: Response): void {
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
function getSpecification(req: HarmonyRequest, res: Response): void {
  // Defined inline because the index file deals with the YAML spec.
  res.append('Content-type', 'text/openapi+yaml;version=3.0');
  res.send(openApiContent.replace('no-default-cmr-collection', req.collectionIds.join('/')));
}

/**
 * Sets up the express application with the OpenAPI routes for OGC API - Coverages
 *
 * @param {Application} app The express application
 * @returns {void}
 */
export function addOpenApiRoutes(app: any): void {
  // TODO - Calls from router.js to this are failing with argument of type 'Router' is not
  // assignable to parameter of type 'Application'. Not sure how to resolve because the calls
  // in here are not compatible with Router.
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
 * @param {Application} app The express application which needs error handling routes
 * @returns {void}
 */
export function handleOpenApiErrors(app: Application): void {
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
