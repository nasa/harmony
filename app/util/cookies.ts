/**
 * This module provides functions to support setting cookies associated with the
 * redirect to Earth Data Login.
 * Most of the functions in the module are 'recipes' for cookies that are used by
 * the only public function, `setCookies`. The 'recipe' functions all have the
 * same signature, taking a request argument and returning a tuple
 * containing the cookie name, value, and options.
 */

import { Response } from 'express';
import { mergeParameters } from './parameter-parsing-helpers';
import * as urlUtil from './url';
import HarmonyRequest from '../models/harmony-request';
import { get } from 'lodash';
import { randomBytes } from 'crypto';

export const cookieOptions = { signed: true, sameSite: 'Lax' };

/**
 * Recipe for a cookie to support handling shapefiles
 *
 * @param req - The request
 * @returns a tuple containing the name and value for the cookie
 */
function _shapefile(req: HarmonyRequest): string[] {
  // if a shapefile was uploaded set a cookie with a url for the shapefile and
  // the other POST form parameters
  const shapefile = get(req, 'files.shapefile[0]') || get(req, 'file');
  if (!shapefile) return [];

  const { mimetype, key, bucket, path } = shapefile;
  const shapefileParams = { mimetype, key, bucket, path };
  return ['shapefile', `j:${JSON.stringify(shapefileParams)}`];
}

/**
 * Recipe for the 'redirect' cookie
 *
 * @param req - The request
 * @returns a tuple containing the name and value for the cookie
 */
function _redirect(req: HarmonyRequest): string[] {
  if (req.files || req.body) {
    // merge form parameters into the query on req so they get used
    // when building the redirect
    mergeParameters(req);
  }

  return ['redirect', urlUtil.getRequestUrl(req)];
}

/**
 * Recipe for the 'state' cookie
 *
 * @returns a tuple containing the name and value for the cookie
 */
function _state(): string[] {
  const state = randomBytes(16).toString('hex');

  return ['state', state];
}

const edlRecipes = [
  _shapefile,
  _redirect,
  _state,
];

const authorizedRecipes = [
  _shapefile,
];

/**
 * Set cookies on the response before calling EDL.
 *
 * @param req - The request
 * @param res - The response
 * @param options - The options to use when setting the cookie
 * @returns the value for the state cookie
 */
export function setCookiesForEdl(req: HarmonyRequest, res: Response, options: object): string {
  let stateValue: string;
  edlRecipes.forEach((recipe) => {
    const [name, value] = recipe(req);
    if (name) {
      res.cookie(name, value, options);
    }
    if (name == 'state') {
      stateValue = value;
    }
  });
  return stateValue;
}

/**
 * Set cookies on the response when handling an authorized request.
 *
 * @param req - The request
 * @param res - The response
 * @param options - The options to use when setting the cookie
 */
export function setCookiesForAuthorized(req: HarmonyRequest, res: Response, options: object): void {
  authorizedRecipes.forEach((recipe) => {
    const [name, value] = recipe(req);
    if (name) {
      res.cookie(name, value, options);
    }
  });
}
