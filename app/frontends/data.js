
/**
 * Given a URL that is not necessarily public-facing, produces a URL to that data
 * which can be used to reference the data so long as it exists at the source location.
 *
 * Algorithmically:
 *    - If the link starts with "s3://", it gets transformed into a "${frontendRoot}/data/*"
 *      URL on the Harmony frontend endpoint which can be accessed by anyone using EDL and
 *      internally will pre-sign the URL when requested
 *    - If the link starts with "https?://" it is assumed to already be a public-facing
 *      URL and is returned
 *    - If the link is anything else, throws a TypeError
 *
 * @param {string} frontendRoot The root URL to use when producing URLs relative to the Harmony root
 * @param {string} url a URL to the data location
 * @returns {string} a URL
 * @throws {TypeError} If the provided URL cannot be handled
 */
function createPublicPermalink(frontendRoot, url) {
  return ['TODO', frontendRoot, url];
}

/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getData(req, res) {
  return ['TODO', req, res];
}

module.exports = { getData, createPublicPermalink };
