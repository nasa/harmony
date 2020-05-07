import * as urlUtil from './url';

/**
 * This module provides functions to support setting cookies associated with the
 * redirect to Earth Data Login.
 * Most of the functions in the module are 'recipes' for cookies that are used by
 * the only public function, `setCookies`. The 'recipe' functions all have the
 * same signature, taking a request argument and returning a tuple
 * containing the cookie name, value, and options.
 */

export const cookieOptions = { signed: true, secure: process.env.USE_HTTPS === 'true' };

/**
 * Recipe for a cookie to support handling shapefiles
 *
 * @param {object} req The request
 * @return {Array} a tuple containing the name and value for the cookie
 * @private
 */
function _shapefile(req) {
  // if a shapefile was uploaded set a cookie with a url for the shapefile and
  // the other POST form parameters
  if (!req.files) return [];

  const { mimetype, key, bucket } = req.files.shapefile[0];
  const shapefileParams = { mimetype, key, bucket };
  return ['shapefile', `j:${JSON.stringify(shapefileParams)}`];
}

/**
 * Recipe for the 'redirect' cookie
 *
 * @param {*} req The request
 * @returns {Array} a tuple containing the name and value for the cookie
 * @private
 */
function _redirect(req) {
  if (req.files) {
    // copy other form parameter to the query field on req so they get used
    // when building the redirect
    req.query = req.body;
  }

  return ['redirect', urlUtil.getRequestUrl(req)];
}

const edlRecipes = [
  _shapefile,
  _redirect,
];

const authorizedRecipes = [
  _shapefile,
];

/**
 * Set cookies on the response before calling EDL.
 *
 * @param {object} req The request
 * @param {object} res The response
 * @param {object} options The options to use when setting the cookie
 * @returns {void}
 */
export function setCookiesForEdl(req, res, options) {
  edlRecipes.forEach((recipe) => {
    const [name, value] = recipe(req);
    if (name) {
      res.cookie(name, value, options);
    }
  });
}

/**
 * Set cookies on the response when handling an authorized request.
 *
 * @param {object} req The request
 * @param {object} res The response
 * @param {object} options The options to use when setting the cookie
 * @returns {void}
 */
export function setCookiesForAuthorized(req, res, options) {
  authorizedRecipes.forEach((recipe) => {
    const [name, value] = recipe(req);
    if (name) {
      res.cookie(name, value, options);
    }
  });
}
