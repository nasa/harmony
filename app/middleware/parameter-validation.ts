import { NextFunction, Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { RequestValidationError } from '../util/errors';
import { Conjunction, listToText } from '../util/string';
import { keysToLowerCase } from '../util/object';
import { coverageRangesetGetParams, coverageRangesetPostParams } from '../frontends/ogc-coverages/index';

/**
 * Middleware to execute various parameter validations
 */

const RANGESET_ROUTE_REGEX = /^\/.*\/ogc-api-coverages\/.*\/collections\/.*\/coverage\/rangeset/;

/**
 * The accepted values for the `linkType` parameter for job status requests
 */
const validLinkTypeValues = ['http', 'https', 's3'];

/**
 * Validate that the value provided for the `linkType` parameter is one of 'http', 'https', or 's3'
 *
 * @param req - The client request
 */
function validateLinkTypeParameter(req: HarmonyRequest): void {
  const keys = keysToLowerCase(req.query);
  const linkType = keys.linktype?.toLowerCase();
  if (linkType && !validLinkTypeValues.includes(linkType)) {
    const listString = listToText(validLinkTypeValues, Conjunction.OR);
    throw new RequestValidationError(`Invalid linkType '${linkType}' must be ${listString}`);
  }
}

/**
 * Validate that the parameter names are correct.
 *  (Performs case insensitive comparison.)
 * 
 * @param requestedParams - names of the parameters provided by the user
 * @param allowedParams - names of the allowed parameters
 * @throws RequestValidationError - if disallowed parameters are detected
 */
export function validateParameterNames(requestedParams: string[], allowedParams: string[]): void {
  const requestedParamsLower = requestedParams.map(param => param.toLowerCase());
  const allowedParamsLower = allowedParams.map(param => param.toLowerCase());
  const invalidParams = [];
  requestedParamsLower.forEach((param, index) => {
    const isNotAllowed = !allowedParamsLower.includes(param);
    if (isNotAllowed) {
      invalidParams.push(requestedParams[index]);
    }
  });
  if (invalidParams.length) {
    const incorrectListString = listToText(invalidParams, Conjunction.AND);
    const allowedListString = listToText(allowedParams, Conjunction.AND);
    throw new RequestValidationError(`Invalid parameter(s): ${incorrectListString}. Allowed parameters are: ${allowedListString}.`);
  }
}

/**
 * Validate that the req query parameter names are correct according to Harmony implementation of OGC spec.
 * 
 * @param req - The client request
 * @throws RequestValidationError - if disallowed parameters are detected
 */
function validateCoverageRangesetParameterNames(req: HarmonyRequest): void {
  const requestedParams = Object.keys(req.query);
  const allowedParams = req.method.toLowerCase() == 'get' ? coverageRangesetGetParams : coverageRangesetPostParams;
  validateParameterNames(requestedParams, allowedParams);
}

/**
 * Express.js middleware to validate parameters. This must be installed after the error handler
 * middleware.
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export default function parameterValidation(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  try {
    validateLinkTypeParameter(req);
    if (req.url.match(RANGESET_ROUTE_REGEX)) {
      validateCoverageRangesetParameterNames(req);
    }
  } catch (e) {
    return next(e);
  }
  return next();
}
