import { initialize } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import { Application, Response, Router } from 'express';
import * as yaml from 'js-yaml';
import getLandingPage from './get-landing-page';
import getRequirementsClasses from './get-requirements-classes';

import getCoverageRangeset from './get-coverage-rangeset';
import postCoverageRangeset from './post-coverage-rangeset';

import { describeCollection, describeCollections } from './describe-collections';
import HarmonyRequest from '../../models/harmony-request';

interface OgcSchemaHttpMethod {
  parameters: {
    $ref: string
  }[]
}

interface OgcSchemaCoverages {
  paths : {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '/collections/{collectionId}/coverage/rangeset': {
      get: OgcSchemaHttpMethod,
      post: OgcSchemaHttpMethod
    }
  }
}

export const version = '1.0.0';
const openApiRoot = path.join(__dirname, '..', '..', 'schemas', 'ogc-api-coverages', version);
const openApiPath = path.join(openApiRoot, `ogc-api-coverages-v${version}.yml`);
export const openApiContent = fs.readFileSync(openApiPath, 'utf-8');
const ogcSchemaCoverages = yaml.load(openApiContent, { schema: yaml.DEFAULT_SCHEMA }) as OgcSchemaCoverages;
export const coverageRangesetGetParams = ogcSchemaCoverages
  .paths['/collections/{collectionId}/coverage/rangeset'].get.parameters
  .map(param => param.$ref.split('/').pop());
export const coverageRangesetPostParams = ['shapefile'].concat(ogcSchemaCoverages
  .paths['/collections/{collectionId}/coverage/rangeset'].post.parameters
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
  res.send(openApiContent.replace('no-default-cmr-collection', req.context.collectionIds.join('/')));
}

/**
 * Sets up the express application with the OpenAPI routes for OGC API - Coverages
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

