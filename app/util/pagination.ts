import { Request, Response } from 'express';
import { IPagination as Pagination } from 'knex-paginate';
import { Link } from './links';
import { RequestValidationError } from './errors';
import { getRequestUrl } from './url';

export { Pagination };

export interface PagingParams {
  page: number;
  limit: number;
}

/**
 * Validates that the given string parameter is a positive integer, returning the
 * corresponding number if it is or throwing a validation error if it isn't
 * @param {Request} req the Express request possibly containing paging params
 * @param {string} paramName the name of the parameter being validated, for error messaging
 * @param {number} defaultValue the default to return if the parameter is not set
 * @param {number} min the minimum acceptable value the number
 * @param {number} max the maximum acceptable value the number
 * @returns {number} the numeric value of the parameter
 * @throws {RequestValidationError} if the passed value is not a positive integer
 */
function parseIntegerParam(
  req: Request,
  paramName: string,
  defaultValue: number,
  min: number = null,
  max: number = null,
): number {
  const strValue = req.query[paramName];
  if (!strValue) {
    return defaultValue;
  }
  const value = +strValue;
  if (Number.isNaN(value)
    || !Number.isSafeInteger(value)
    || (min !== null && value < min)
    || (max !== null && value > max)) {
    const constraints = [];
    if (min !== null) constraints.push(` greater than or equal to ${min}`);
    if (max !== null) constraints.push(` less than or equal to ${max}`);
    throw new RequestValidationError(`Parameter "${paramName}" is invalid. Must be an integer${constraints.join(' and')}.`);
  }
  return value;
}

/**
 * Gets the paging parameters from the given request
 * @param {Request} req the Express request possibly containing paging params
 * @returns {PagingParams} the paging parameters
 * @throws {RequestValidationError} if invalid paging parameters are provided
 */
export function getPagingParams(req: Request): PagingParams {
  return {
    page: parseIntegerParam(req, 'page', 1, 1),
    limit: parseIntegerParam(req, 'limit', 10, 1, 2000),
  };
}

/**
 * Returns a list of links for paginating a response
 * @param {Request} req the Express request to generate links relative to
 * @param {Pagination} pagination pagination info for the current request
 * @param {number} page the page number for the link
 * @param {string} rel the name of the link relation
 * @param {string} relName the name of the link relation
 * @returns {Link} the generated link
 */
function getPagingLink(
  req: Request,
  pagination: Pagination,
  page: number,
  rel: string,
  relName: string = rel,
): Link {
  const { lastPage, perPage } = pagination;
  const suffix = lastPage === 1 && page === 1 ? '' : ` (${page} of ${lastPage})`;
  return {
    title: `The ${relName} page${suffix}`,
    href: getRequestUrl(req, true, { page, limit: perPage }),
    rel,
    type: 'application/json',
  };
}

/**
 * Returns a list of links for paginating a response
 * @param {Request} req the Express request to generate links relative to
 * @param {Pagination} pagination the pagination information as returned by, e.g. knex-paginate
 * @returns {Link[]} the links to paginate
 */
export function getPagingLinks(req: Request, pagination: Pagination): Link[] {
  const result = [];
  const { currentPage, lastPage } = pagination;
  if (currentPage > 2) result.push(getPagingLink(req, pagination, 1, 'first'));
  if (currentPage > 1) result.push(getPagingLink(req, pagination, currentPage - 1, 'prev', 'previous'));
  result.push(getPagingLink(req, pagination, currentPage, 'self', 'current'));
  if (currentPage < lastPage) result.push(getPagingLink(req, pagination, currentPage + 1, 'next'));
  if (currentPage < lastPage - 1) result.push(getPagingLink(req, pagination, lastPage, 'last'));
  return result;
}

/**
 * Sets paging headers on the response according to the supplied pagination values
 * @param {Response} res the Express response where paging params should be set
 * @param {Pagination} pagination paging information about the request
 * @returns {void}
 */
export function setPagingHeaders(res: Response, pagination: Pagination): void {
  res.set('Harmony-Hits', pagination.total.toString());
}
