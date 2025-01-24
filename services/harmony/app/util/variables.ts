import { NextFunction, Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { CmrCollection, CmrUmmVariable } from './cmr';
import { RequestValidationError } from './errors';
import { parseMultiValueParameter } from './parameter-parsing-helpers';

export interface HarmonyVariable {
  id: string;
  name: string;
  fullPath: string;
  relatedUrls?: HarmonyRelatedUrl[];
  type?: string;
  subtype?: string;
}

export interface HarmonyRelatedUrl {
  url: string;
  urlContentType: string;
  type: string;
  subtype?: string;
  description?: string;
  format?: string;
  mimeType?: string;
}

interface VariableInfo {
  collectionId: string;
  shortName: string; // collection short_name
  versionId: string; // collection version_id
  variables?: CmrUmmVariable[];
  coordinateVariables?: CmrUmmVariable[];
}

/**
 * Returns the harmony representation of a variable given a CMR UMM variable
 *
 * @param cmrVariable - The CMR UMM representation of a variable
 * @returns the Harmony representation of a variable
 */
export function cmrVarToHarmonyVar(cmrVariable: CmrUmmVariable): HarmonyVariable {
  const { umm, meta } = cmrVariable;
  const harmonyVariable: HarmonyVariable = {
    id: meta['concept-id'],
    name: umm.Name,
    fullPath: umm.Name,
  };

  if (umm.VariableType) {
    harmonyVariable.type = umm.VariableType;
  }

  if (umm.VariableSubType) {
    harmonyVariable.subtype = umm.VariableSubType;
  }

  if (umm.RelatedURLs) {
    harmonyVariable.relatedUrls = umm.RelatedURLs
      .map((relatedUrl) => {
        return {
          url: relatedUrl.URL,
          urlContentType: relatedUrl.URLContentType,
          type: relatedUrl.Type,
          subtype: relatedUrl.Subtype,
          description: relatedUrl.Description,
          format: relatedUrl.Format,
          mimeType: relatedUrl.MimeType,
        };
      });
  }

  return harmonyVariable;
}

/**
 * Get the full path for the given variable.
 * @param v - The variable of interest
 * @returns path - The full path to the variable
 */
export function fullPath(v: CmrUmmVariable): string {
  return v.umm.Name;
}

/**
 * Returns true if the string value matches the given variable's name or concept id
 * @param v - The variable to check
 * @param s - The string to match against the variable's name or concept id
 * @returns true if given value matches variable name or concept id
 */
function doesPathMatch(v: CmrUmmVariable, s: string): boolean {
  return s === v.umm.Name || s === v.meta['concept-id'];
}

const coordinateType = 'COORDINATE';

/**
 * Returns the coordinate variables from a list of variables
 * @param variables - An array of CMR UMM Variables
 * @returns The subset of variables that are coordinate variables
 */
export function getCoordinateVariables(variables: CmrUmmVariable[]): CmrUmmVariable[] {
  return variables.filter((v) => v.umm.VariableType === coordinateType);
}

/**
 * validate variable and queryVars parameters, throw exception if failed
 * @param variableIds - The variable ids in url path
 * @param queryVars - The variables in query params
 */
export function validateVariables(variableIds: string[], queryVars: string | string[]): void {
  queryVars = parseMultiValueParameter(queryVars);
  if (variableIds.indexOf('all') !== -1 && variableIds.length !== 1) {
    throw new RequestValidationError('"all" cannot be specified alongside other variables');
  }

  if (variableIds.indexOf('parameter_vars') !== -1) {
    if (!queryVars || queryVars.length < 1) {
      throw new RequestValidationError('"parameter_vars" specified, but no variables given');
    }
    if (queryVars.indexOf('all') !== -1 && queryVars.length !== 1) {
      throw new RequestValidationError('"all" cannot be specified alongside other variables');
    }
  } else {
    // can't specify vars in the query AND in the path
    if (queryVars.length > 0) {
      throw new RequestValidationError('Value "parameter_vars" must be used in the url path when variables are passed in the query parameters or request body');
    }
  }
}

/**
 * Creates the variable info objects without looking anything up in CMR. Passes in all of the variables
 * provided to all of the collections in the request and leaves it up to the service to validate.
 *
 * @param eosdisCollections - An array of collections
 * @param variableIds - The list of variables
 * @returns an array of objects with a collectionId and list
 *   of variables e.g. `[{ collectionId: C123-PROV1, variables: [<Variable object>] }]`
 */
function constructVariableInfoWithoutValidation(
  eosdisCollections: CmrCollection[],
  variables: string[],
): VariableInfo[] {
  console.log(`CDD: I am constructing it without CMR validation: ${JSON.stringify(eosdisCollections)}`);
  const variableInfo = [];

  // Construct an imitation of what CMR would return from UMM-Var since we are not using variables
  // from the CMR, but later functions expect the variables in CMR form
  const imitationCmrVariables = [];
  for (const variable of variables) {
    imitationCmrVariables.push({
      umm: { Name: variable },
      meta: { 'concept-id': 'unknown' },
    });
  }
  for (const collection of eosdisCollections) {
    const coordinateVariables = getCoordinateVariables(collection.variables);
    variableInfo.push({
      collectionId: collection.id, shortName: collection.short_name,
      versionId: collection.version_id, variables: imitationCmrVariables,
      coordinateVariables,
    });
  }
  return variableInfo;
}

/**
 * Returns the
 * collectionId parameter return the full variables which match.
 *
 * @param collectionIdParam - The OGC collectionId query parameter
 * @param queryVars - A string of comma separated variable names or an array of variable names
 * - taken from the request object via the `variable` parameter
 * @returns an array of requested variables (either concept IDs or variable names)
 * @throws RequestValidationError - if the parameter combinations for query parmameters and
 * route are invalid for specifying variables
 */
export function parseVariables(
  collectionIdParam: string,
  queryVars: string | string[],
): string[] {
  // Note that "collectionId" from the Open API spec is an OGC API Collection, which is
  // what we would call a variable (or sometimes a named group of variables).  In the
  // OpenAPI spec doc, a "collection" refers to a UMM-Var variable, and a "CMR collection" refers
  // to a UMM-C collection.  In the code, wherever possible, collections are UMM-C collections
  // and variables are UMM-Var variables.  The following line is the confusing part where we
  // translate between the two nomenclatures.
  let variableIds = collectionIdParam.split(',');

  validateVariables(variableIds, queryVars);

  if (variableIds.indexOf('parameter_vars') !== -1 && queryVars) {
    variableIds = parseMultiValueParameter(queryVars);
  }

  // No variables requested to be subset
  if (variableIds.length === 1 && variableIds[0] === 'all') {
    variableIds = [];
  }
  return variableIds;
}

/**
 * Given a list of EOSDIS collections and variables parsed from the CMR and an OGC
 * collectionId parameter return the full variables which match.
 *
 * @param eosdisCollections - An array of collections
 * @param collectionIdParam - The OGC collectionId query parameter
 * @param queryVars - A string of comma separated variable names or an array of variable names
 * - taken from the request object via the `variable` parameter
 * @param shouldValidateUmmVar - True if we should verify the variables exist in the CMR
 * @returns an array of objects with a collectionId and list
 *   of variables e.g. `[{ collectionId: C123-PROV1, variables: [<Variable object>] }]`
 * @throws RequestValidationError - if the requested OGC collection ID parameter is not valid
 * based on the variables in the collections
 */
export function getVariableInfo(
  eosdisCollections: CmrCollection[],
  variableIds: string[],
  shouldValidateUmmVar: boolean,
): VariableInfo[] {
  let variableInfo = [];
  if (!shouldValidateUmmVar) {
    variableInfo = constructVariableInfoWithoutValidation(eosdisCollections, variableIds);
  } else {
    if (variableIds.length === 0) {
      // "All" variables or none were requested to be subset, just provide the coordinate variables
      // Do not provide a list of variables to subset
      for (const collection of eosdisCollections) {
        const coordinateVariables = getCoordinateVariables(collection.variables);
        variableInfo.push({
          collectionId: collection.id, shortName: collection.short_name,
          versionId: collection.version_id, coordinateVariables,
        });
      }
    } else {
      // Figure out which variables belong to which collections and whether any are missing.
      // Note that a single variable name may appear in multiple collections
      const missingVariables = new Set<string>(variableIds);
      for (const collection of eosdisCollections) {
        // Get the list of variables configured in services.yml for this collection. If the
        // returned set is empty then we will ignore it, otherwise we will only add variables
        // in that set
        const coordinateVariables = getCoordinateVariables(collection.variables);
        const variables = [];
        for (const variableId of variableIds) {
          const variable = collection.variables.find((v) => doesPathMatch(v, variableId));
          if (variable) {
            missingVariables.delete(variableId);
            // only add the variable to the list if it does not exist.
            // This is to guard against when variable name mixed with concept id that references the same variable
            if (variables.find(v => v.meta['concept-id'] === variable.meta['concept-id']) === undefined) {
              variables.push(variable);
            }
          }
        }
        variableInfo.push({
          collectionId: collection.id, shortName: collection.short_name,
          versionId: collection.version_id, variables, coordinateVariables,
        });
      }
      if (missingVariables.size > 0) {
        throw new RequestValidationError(`Coverages were not found for the provided variables: ${Array.from(missingVariables).join(', ')}`);
      }
    }
  }
  return variableInfo;
}

/**
 * Helper to get the variables separately by collection.
 *
 * @param layers - The WMS layers provided with the request
 * @param collections - An array of the CMR Collections
 * @returns an object with the key being the collection and the value a list of
 * variables for that collection
 */
export function getVariablesForCollection(
  layers: string, collections: CmrCollection[],
): VariableInfo[] {
  const variablesByCollection = {};
  const collectionVariables = layers.split(',');
  for (const collectionVariableStr of collectionVariables) {
    const [collectionId, variableId] = collectionVariableStr.split('/');

    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) {
      throw new RequestValidationError(`Invalid layer: ${collectionVariableStr}`);
    }

    if (!variablesByCollection[collectionId]) {
      variablesByCollection[collectionId] = [];
    }
    if (variableId) {
      const variable = collection.variables.find((v) => v.meta['concept-id'] === variableId);
      if (!variable) {
        throw new RequestValidationError(`Invalid layer: ${collectionVariableStr}`);
      }
      variablesByCollection[collectionId].push(variable);
    }
  }

  const variableInfo = [];
  for (const collection of collections) {
    const coordinateVariables = getCoordinateVariables(collection.variables);
    const variables = variablesByCollection[collection.id];
    variableInfo.push({
      collectionId: collection.id, shortName: collection.short_name,
      versionId: collection.version_id, variables, coordinateVariables,
    });
  }
  return variableInfo;
}

/**
 * Middleware to match the requested variables with CMR UMM-Var records to get
 * the required variable information
 * @param req - The client request, containing an operation
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
export function validateAndSetVariables(
  req: HarmonyRequest, _res: Response, next: NextFunction,
): void {
  const { operation, context } = req;
  if (!operation?.sources) {
    return next();
  }

  try {
    const varInfos = getVariableInfo(
      context.collections,
      context.requestedVariables,
      context.serviceConfig.validate_variables !== false,
    );

    console.log(`Var infos are: ${JSON.stringify(varInfos)}`);

    console.log(`Requested variables were ${context.requestedVariables}`);

    for (const varInfo of varInfos) {
      operation.addSource(varInfo.collectionId, varInfo.shortName, varInfo.versionId,
        varInfo.variables, varInfo.coordinateVariables);
    }
  } catch (e) {
    return next(e);
  }

  return next();
}