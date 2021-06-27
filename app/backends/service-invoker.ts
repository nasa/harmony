import { RequestHandler, Response } from 'express';
import { getRequestRoot, getRequestUrl } from '../util/url';
import * as services from '../models/services/index';
import { objectStoreForProtocol } from '../util/object-store';
import { ServiceError } from '../util/errors';
import InvocationResult from '../models/services/invocation-result';
import HarmonyRequest from '../models/harmony-request';

import env = require('../util/env');

/**
 * Copies the header with the given name from the given request to the given response
 *
 * @param serviceResult - The service result to copy from
 * @param res - The response to copy to
 * @param header - The name of the header to set
 */
function copyHeader(serviceResult: InvocationResult, res: Response, header: string): void {
  res.set(header, serviceResult.headers[header.toLowerCase()]);
}

/**
 * Translates the given request sent by a backend service into the given
 * response sent to the client.
 *
 * @param serviceResult - The service result
 * @param user - The user making the request
 * @param res - The response to send to the client
 * @throws ServiceError - If the backend service returns an error
 */
async function translateServiceResult(serviceResult, user, res): Promise<void> {
  for (const k of Object.keys(serviceResult.headers || {})) {
    if (k.toLowerCase().startsWith('harmony')) {
      copyHeader(serviceResult, res, k);
    }
  }
  const { error, statusCode, redirect, content, stream } = serviceResult;
  if (error) {
    throw new ServiceError(statusCode || 400, error);
  } else if (redirect) {
    const store = objectStoreForProtocol(redirect.split(':')[0]);
    let dest = redirect;
    if (store) {
      dest = await store.signGetObject(redirect, { 'A-userid': user });
    }
    res.redirect(303, dest);
  } else if (content) {
    res.send(content);
  } else {
    copyHeader(serviceResult, res, 'Content-Type');
    copyHeader(serviceResult, res, 'Content-Length');
    stream.pipe(res);
  }
}

/**
 * Express.js handler that calls backend services, registering a URL for the backend
 * to POST to when complete.  Responds to the client once the backend responds.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @returns Resolves when the request is complete
 * @throws ServiceError - if the service call fails or returns an error
 * @throws NotFoundError - if no service can handle the callback
 */
export default async function serviceInvoker(
  req: HarmonyRequest, res: Response,
): Promise<RequestHandler> {
  const startTime = new Date().getTime();

  req.operation.user = req.user || 'anonymous';
  req.operation.client = env.harmonyClientId;
  req.operation.accessToken = req.accessToken || '';
  const service = services.buildService(req.context.serviceConfig, req.operation);

  let serviceResult = null;
  const serviceLogger = req.context.logger.child({
    application: 'backend',
    component: `${service.constructor.name}`,
  });
  try {
    serviceResult = await service.invokeOrAttach(
      serviceLogger, getRequestRoot(req), getRequestUrl(req),
    );
    await translateServiceResult(serviceResult, req.operation.user, res);
  } finally {
    if (serviceResult && serviceResult.onComplete) {
      serviceResult.onComplete();
    }
  }
  const msTaken = new Date().getTime() - startTime;
  const { model } = service.operation;
  const { frontend, logger } = req.context;
  const spatialSubset = model.subset !== undefined && Object.keys(model.subset).length > 0;
  const temporalSubset = model.temporal !== undefined && Object.keys(model.temporal).length > 0;
  const varSources = model.sources.filter((s) => s.variables && s.variables.length > 0);
  const variableSubset = varSources.length > 0;
  logger.info('Backend service request complete',
    {
      durationMs: msTaken,
      frontend,
      ...model,
      service: service.config.name,
      spatialSubset,
      temporalSubset,
      variableSubset,
    });
  return serviceResult;
}
