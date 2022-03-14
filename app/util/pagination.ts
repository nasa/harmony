import { Request, Response } from 'express';
import { ILengthAwarePagination } from 'knex-paginate';
import { Link } from './links';
import { RequestValidationError } from './errors';
import { getRequestUrl } from './url';
import env from './env';

export interface PagingParams {
  page: number;
  limit: number;
}

/**
 * Build the RequestValidationError with a custom message that specifies what the validation constraints are.
 * @param min - min constraint for the parameter
 * @param max - max constraint for the parameter
 * @param paramName - name of the parameter being validated
 * @returns RequestValidationError
 */
function buildIntegerParseError(min: number, max: number, paramName: string): RequestValidationError {
  const constraints = [];
  if (min !== null)
    constraints.push(` greater than or equal to ${min}`);
  if (max !== null)
    constraints.push(` less than or equal to ${max}`);
  return new RequestValidationError(`Parameter "${paramName}" is invalid. Must be an integer${constraints.join(' and')}.`);
}

/**
 * Validates that the given string parameter is a positive integer, returning the
 * corresponding number if it is or throwing a validation error if it isn't
 * @param req - The Express request possibly containing paging params
 * @param paramName - The name of the parameter being validated, for error messaging
 * @param defaultValue - the default to return if the parameter is not set
 * @param min - The minimum acceptable value the number
 * @param max - The maximum acceptable value the number
 * @param useMaxWhenExceeded - If true, return 'max' (rather than an error) when the integer provided exceeds 'max'
 * @returns The numeric value of the parameter
 * @throws {@link RequestValidationError} If the passed value is not a positive integer
 */
function parseIntegerParam(
  req: Request,
  paramName: string,
  defaultValue: number,
  min: number = null,
  max: number = null,
  useMaxWhenExceeded = false,
): number {
  const strValue = req.query[paramName];
  if (!strValue) {
    return defaultValue;
  }
  const value = +strValue;
  if (Number.isNaN(value)
    || !Number.isSafeInteger(value)
    || (min !== null && value < min)) {
    throw buildIntegerParseError(min, max, paramName);
  }
  if ((max !== null && value > max)) {
    if (!useMaxWhenExceeded) {
      throw buildIntegerParseError(min, max, paramName);
    } else {
      return max;
    }
  }
  return value;
}

/**
 * Gets the paging parameters from the given request
 * @param req - The Express request possibly containing paging params
 * @param defaultPageSize - The page size to use if no `limit` parameter is in the query
 * @param useMaxWhenExceeded - If true, return 'max' (rather than an error) when the integer provided exceeds 'max'
 * @returns The paging parameters
 * @throws {@link RequestValidationError} If invalid paging parameters are provided
 */
export function getPagingParams(req: Request, defaultPageSize: number, useMaxWhenExceeded = false): PagingParams {
  return {
    page: parseIntegerParam(req, 'page', 1, 1),
    limit: parseIntegerParam(req, 'limit', defaultPageSize, 0, env.maxPageSize, useMaxWhenExceeded),
  };
}

/**
 * Returns a list of links for paginating a response
 * @param req - the Express request to generate links relative to
 * @param pagination - pagination info for the current request
 * @param page - the page number for the link
 * @param rel - the name of the link relation
 * @param relName - the name of the link relation
 * @returns the generated link
 */
function getPagingLink(
  req: Request,
  pagination: ILengthAwarePagination,
  page: number,
  rel: string,
  relName: string = rel,
): Link {
  const { lastPage, perPage } = pagination;
  const suffix = (lastPage <= 1 && page === 1) || perPage === 0 ? '' : ` (${page} of ${lastPage})`;
  return {
    title: `The ${relName} page${suffix}`,
    href: getRequestUrl(req, true, { page, limit: perPage }),
    rel,
    type: 'application/json',
  };
}

/**
 * Returns a list of links for paginating a response
 * @param req - the Express request to generate links relative to
 * @param pagination - the pagination information as returned by, e.g. knex-paginate
 * @returns the links to paginate
 */
export function getPagingLinks(req: Request, pagination: ILengthAwarePagination): Link[] {
  const result = [];
  const { currentPage, lastPage, perPage } = pagination;
  // const { currentPage, lastPage, perPage } = pagination as unknown as { lastPage: number; perPage; number; currentPage: number; total: number; };
  if (perPage > 0 && currentPage > 2) result.push(getPagingLink(req, pagination, 1, 'first'));
  if (perPage > 0 && currentPage > 1) result.push(getPagingLink(req, pagination, currentPage - 1, 'prev', 'previous'));
  result.push(getPagingLink(req, pagination, currentPage, 'self', 'current'));
  if (perPage > 0 && currentPage < lastPage) result.push(getPagingLink(req, pagination, currentPage + 1, 'next'));
  if (perPage > 0 && currentPage < lastPage - 1) result.push(getPagingLink(req, pagination, lastPage, 'last'));
  return result;
}

/**
 * Sets paging headers on the response according to the supplied pagination values
 * @param res - The Express response where paging params should be set
 * @param pagination - Paging information about the request
 */
export function setPagingHeaders(res: Response, pagination: ILengthAwarePagination): void {
  res.set('Harmony-Hits', pagination.total.toString());
}
