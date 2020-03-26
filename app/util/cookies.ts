const urlUtil = require('./url');

/**
 * This module provides functions to support setting cookies associated with the
 * redirect to Earth Data Login.
 * Most of the functions in the module are 'recipes' for cookies that are used by
 * the only public function, `setCookies`. The 'recipe' functions all have the
 * same signature, taking a request argument and returning a tuple
 * containing the cookie name, value, and options.
 */

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
  let rval = [];

  if (req.files) {
    const { mimetype, key, bucket } = req.files.shapefile[0];
    const shapefileParams = { mimetype, key, bucket };
    rval = ['shapefile', `j:${JSON.stringify(shapefileParams)}`];
  }

  return rval;
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

const recipes = [
  _shapefile,
  _redirect,
];

/**
 * Set cookies on the response before calling EDL.
 *
 * @param {object} req The request
 * @param {object} res The response
 * @param {object} options The options to use when setting the cookie
 * @returns {void} nothing
 */
function setCookiesForEdl(req, res, options) {
  recipes.forEach((recipe) => {
    const [name, value] = recipe(req);
    if (name) {
      res.cookie(name, value, options);
    }
  });
}

module.exports = { setCookiesForEdl };
