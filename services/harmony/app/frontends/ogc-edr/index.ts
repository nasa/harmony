import { initialize } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import express, { Application, Response, Router } from 'express';
import * as yaml from 'js-yaml';
import getLandingPage from '../ogc-coverages/get-landing-page';
import getRequirementsClasses from '../ogc-coverages/get-requirements-classes';

import { getDataForCube, postDataForCube } from './get-data-for-cube';
import { getDataForArea, postDataForArea } from './get-data-for-area';
import { getDataForPoint, postDataForPoint } from './get-data-for-point';

import HarmonyRequest from '../../models/harmony-request';

interface OgcSchemaHttpMethod {
  parameters: {
    $ref: string
  }[]
}

interface OgcSchemaEdr {
  paths : {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '/collections/{collectionId}/cube': {
      get: OgcSchemaHttpMethod,
      post: OgcSchemaHttpMethod
    }
  }
}

export const version = '1.1.0';
const openApiRoot = path.join(__dirname, '..', '..', 'schemas', 'ogc-api-edr', version);
const openApiPath = path.join(openApiRoot, `ogc-api-edr-v${version}.yml`);
export const openApiContent = fs.readFileSync(openApiPath, 'utf-8');
const ogcSchemaEdr = yaml.load(openApiContent, { schema: yaml.DEFAULT_SCHEMA }) as OgcSchemaEdr;

/**
 * Parse parameter entries from a schema file
 * @param action - type of request in the schema, e.g., 'cube', 'area'
 * @returns an array of parameter names
 */
export function getEdrParameters(action: string): string[] {
  return ogcSchemaEdr
    .paths[`/collections/{collectionId}/${action}`].get.parameters
    .map(param => param.$ref.split('/').pop());
}

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
  app.use(express.json());
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
      getDataForPoint,
      postDataForPoint,
      getDataForRadius: TODO,
      postDataForRadius: TODO,
      getDataForCube,
      postDataForCube,
      getDataForArea,
      postDataForArea,
      getDataForTrajectory: TODO,
      postDataForTrajectory: TODO,
      getDataForCorridor: TODO,
      postDataForCorridor: TODO,
    },
  });
}
