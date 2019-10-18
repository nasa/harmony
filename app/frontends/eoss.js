const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');
const DataOperation = require('../models/data-operation');

const version = '0.1.0';
const openApiPath = path.join(__dirname, '..', 'schemas', 'eoss', version, `eoss-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath, 'utf-8');

// class RequestValidationError extends Error {}

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
        /* HARMONY-55 will implement this functionality - stubbed out for now
         * Convert the request to the data operation model
         * Parameters to support:
         * bbox, crs, rangeSubset, format(maybe)
         * Validate variable parameters (re-use code from wms.js hopefully)
         * Verify parameters make sense based on WFS 3.0 spec
         * Figure out if WFS 3.0 should have get capabilities like endpoint
         * Should the version be part of the URL (/<coll>/eoss/0.1.0/items/<gran>...)
         * Do I need to validate any required data operation fields?
         * Required data operation fields
         *       "required": [
         * "callback",
         * "format",
         * "sources", - nested within sources both collection and granules are required,
         * "subset",
         * "version"
         * ]
         * Granule requires id, name, url
         * Collection is just a string - the collection ID
         * Variable requires id, name
         */
        // TODO util function?
        const query = {};
        for (const k of Object.keys(req.query)) {
          query[k.toLowerCase()] = req.query[k];
        }
        const operation = new DataOperation();
        // operation.crs = 'CRS:84';
        operation.outputFormat = 'image/png';
        operation.version = '0.1.0';
        if (query.bbox) {
          const [west, south, east, north] = query.bbox;
          operation.boundingRectangle = [west, south, east, north];
        }
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
        // query.bbox.split(); // Force the request to crash here
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
