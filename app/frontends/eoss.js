const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');

const version = 0;
const openApiPath = path.join(__dirname, '..', 'schemas', `eoss-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath, 'utf-8');

/**
 * Sets up the express application with the OpenAPI routes for EOSS
 *
 * @param {express.Application} app The express application
 * @returns {void}
 */
function addOpenApiRoutes(app) {
  initialize({
    app,
    apiDoc: openApiPath,
    /* Note: the default way to expose an OpenAPI endpoint is to have express handle paths
     * based on a supplied directory structure. Instead we are using the operations property
     * because we want to include the paths within the OpenAPI specification itself. */
    operations: {
      getLandingPage(req, res) {
        // HARMONY-72 will implement this functionality - stubbed out for now
        res.append('Content-type', 'text/html');
        res.send('<p>A fine landing page for now.<p>');
      },
      getSpecification(req, res) {
        res.append('Content-type', 'text/x-yaml');
        res.send(openApiContent);
      },
      getGranule(req, res) {
        // HARMONY-55 will implement this functionality - stubbed out for now
        res.send('Called getGranule');
      },
    },
  });

  // Handles returning errors formatted as JSON
  app.use((err, req, res, _next) => {
    res.status(err.status).json({
      message: err.message,
      errors: err.errors,
    });
  });
}

module.exports = { addOpenApiRoutes };
