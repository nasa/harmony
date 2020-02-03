const { initialize } = require('express-openapi');
const fs = require('fs');
const path = require('path');
const DataOperation = require('../models/data-operation');
const { keysToLowerCase } = require('../util/object');
const { RequestValidationError } = require('../util/errors');

const version = '0.1.0';
const openApiPath = path.join(__dirname, '..', 'schemas', 'eoss', version, `eoss-v${version}.yml`);
const openApiContent = fs.readFileSync(openApiPath, 'utf-8');

// CMR Granule ID provided as part of the URL
const GRANULE_URL_PATH_REGEX = /\/(?:G\d+-\w+)/g;

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
        req.logger = req.logger.child({ component: 'eoss.getGranule' });
        const query = keysToLowerCase(req.query);
        const operation = new DataOperation();
        operation.crs = query.crs;
        operation.outputFormat = query.format || 'image/tiff';
        if (query.bbox) {
          const [west, south, east, north] = query.bbox;
          operation.boundingRectangle = [west, south, east, north];
        }

        const granuleMatch = req.url.match(GRANULE_URL_PATH_REGEX);
        if (granuleMatch) {
          // Assumes there can only be one granule
          const granuleId = granuleMatch[0].substr(1, granuleMatch[0].length - 1);
          operation.granuleIds = [granuleId];
        }

        // Assuming one collection for now
        const collectionId = req.collections[0].id;
        const variables = [];
        if (query.rangesubset) {
          const variablesRequested = query.rangesubset;
          for (const variableRequested of variablesRequested) {
            const variable = req.collections[0].variables.find((v) => v.name === variableRequested);
            if (!variable) {
              throw new RequestValidationError(`Invalid rangeSubset parameter: ${variableRequested}`);
            }
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
    if (req.path.indexOf('/eoss/') === -1) {
      next(err);
      return;
    }
    if (err.status && err.errors) {
      req.logger.error(`Request validation failed with the following errors: ${JSON.stringify(err.errors)}`);
      res.status(err.status).json({
        message: err.message,
        errors: err.errors,
      });
    } else if (err instanceof RequestValidationError) {
      req.logger.error(err.message);
      res.status(400).json({
        errors: [err.message],
      });
    } else {
      next(err);
    }
  });
}

module.exports = { addOpenApiRoutes };
