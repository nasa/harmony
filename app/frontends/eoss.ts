const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');
const DataOperation = require('../models/data-operation');

const version = '0.1.0';
const openApiPath = path.join(__dirname, '..', 'schemas', 'eoss', version, `eoss-v${version}.yml`);
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
      getGranule(req, res, next) {
        // TODO util function?
        const query = {};
        for (const k of Object.keys(req.query)) {
          query[k.toLowerCase()] = req.query[k];
        }
        const operation = new DataOperation();
        operation.crs = query.crs;
        if (query.format) {
          operation.outputFormat = query.format;
        } else {
          // default to tiff
          operation.outputFormat = 'image/tiff';
        }
        operation.version = '0.1.0'; // TODO should we make the version part of the URL or a query param?
        if (query.bbox) {
          const [west, south, east, north] = query.bbox;
          operation.boundingRectangle = [west, south, east, north];
        }
        // Assuming one collection for now
        const collectionId = req.collections[0].id;
        const variables = [];
        if (query.rangesubset) {
          const variablesRequested = query.rangesubset;
          for (const variableRequested of variablesRequested) {
            const variable = req.collections[0].variables.find((v) => v.name === variableRequested);
            variables.push({ id: variable.concept_id, name: variable.name });
          }
        }
        operation.addSource(collectionId, variables);
        req.operation = operation;
        next();
      },
    },
  });

  // Handles returning OpenAPI errors formatted as JSON
  app.use((err, req, res, next) => {
    if (err.status && err.errors) {
      res.status(err.status).json({
        message: err.message,
        errors: err.errors,
      });
    } else {
      next(err);
    }
  });
}

module.exports = { addOpenApiRoutes };
