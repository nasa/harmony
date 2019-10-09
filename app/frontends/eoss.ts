const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');

const version = 0;
const openApiPath = path.join(__dirname, '..', 'schemas', `eoss-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath);

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
    operations: {
      getLandingPage(req, res) {
        res.append('Content-type', 'text/html');
        res.send('<p>A fine landing page for now.<p>');
      },
      getSpecification(req, res) {
        res.append('Content-type', 'text/x-yaml');
        res.send(openApiContent);
      },
      getGranule(req, res) {
        res.send('Called getGranule\n');
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
