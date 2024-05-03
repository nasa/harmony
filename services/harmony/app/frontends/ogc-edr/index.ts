import { initialize } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import { Application, Response, Router } from 'express';
import * as yaml from 'js-yaml';
import { buildJsonErrorResponse, getCodeForError, getEndUserErrorMessage, getHttpStatusCode } from '../../util/errors';
import getLandingPage from '../ogc-coverages/get-landing-page';
import getRequirementsClasses from '../ogc-coverages/get-requirements-classes';

import getDataForArea from './get-edr-area';
import postDataForArea from './post-edr-area';

import HarmonyRequest from '../../models/harmony-request';

interface OgcSchemaHttpMethod {
  parameters: {
    $ref: string
  }[]
}

interface OgcSchemaEdr {
  paths : {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '/collections/{collectionId}/area': {
      get: OgcSchemaHttpMethod,
      post: OgcSchemaHttpMethod
    }
  }
}

export const version = '1.0.0';
const openApiRoot = path.join(__dirname, '..', '..', 'schemas', 'ogc-api-edr', version);
const openApiPath = path.join(openApiRoot, `ogc-api-edr-v${version}.yml`);
export const openApiContent = fs.readFileSync(openApiPath, 'utf-8');
const ogcSchemaEdr = yaml.load(openApiContent, { schema: yaml.DEFAULT_SCHEMA }) as OgcSchemaEdr;
export const edrGetParams = ogcSchemaEdr
  .paths['/collections/{collectionId}/area'].get.parameters
  .map(param => param.$ref.split('/').pop());
export const edrPostParams = ['shapefile'].concat(ogcSchemaEdr
  .paths['/collections/{collectionId}/area'].post.parameters
  .map(param => param.$ref.split('/').pop()));

/**
 * Express handler that returns a 501 error and "not yet implemented" message to the client
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
function TODO(req: HarmonyRequest, res: Response): void {
  res.status(501);
  res.json('Not yet implemented');
}

/**
 * Express handler that returns the OpenAPI spec for a collection
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
function getSpecification(req: HarmonyRequest, res: Response): void {
  // Defined inline because the index file deals with the YAML spec.
  res.append('Content-type', 'text/openapi+yaml;version=3.0');
  res.send(openApiContent);
}

/**
 * Sets up the express application with the OpenAPI routes for OGC API - EDR
 *
 * @param app - The express application
 */
export function addOpenApiRoutes(app: Router): void {
  initialize({
    app: app as Application,
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
      getCollectionInstances: TODO,
      getDataForPoint: TODO,
      postDataForPoint: TODO,
      getDataForArea,
      postDataForArea,
    },
  });
}

/**
 * Adds error handling appropriate to the OGC API to the given app
 * @param app - The express application which needs error handling routes
 */
export function handleOpenApiErrors(app: Application): void {
  app.use((err, req, res, next) => {
    if (req.path.indexOf('/ogc-api-edr/') === -1) {
      next(err);
      return;
    }

    let statusCode;
    let message;
    let code;
    if (err.status && err.errors) {
      // OpenAPI Validation errors;
      statusCode = +err.status;
      code = 'openapi.ValidationError';
      const messages = err.errors.map((error) => `${error.location} parameter "${error.path}" ${error.message}`);
      message = messages.join('\n\t');
    } else {
      statusCode = getHttpStatusCode(err);
      code = getCodeForError(err);
      message = getEndUserErrorMessage(err);
    }
    res.status(statusCode).json(buildJsonErrorResponse(code, message));

    if (statusCode < 500) {
      req.context.logger.error(`[${code}] ${message}`);
    } else {
      // Make sure we get stack traces when we throw an unexpected exception
      req.context.logger.error(err);
    }
  });
}
