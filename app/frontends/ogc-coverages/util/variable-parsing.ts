import { CmrCollection, CmrUmmVariable } from '../../../util/cmr';
import { RequestValidationError } from '../../../util/errors';

interface VariableInfo {
  collectionId: string;
  variables?: CmrUmmVariable[];
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
 * Returns true if the path matches the variable name or full path (GroupPath/Name)
 * @param v - The variable to check
 * @param p - The path to check. Can be a full path or variable name
 * @returns true if path matches variable name or full path
 */
function doesPathMatch(v: CmrUmmVariable, p: string): boolean {
  return p === v.umm.Name;
}

/**
 * Given a list of EOSDIS collections and variables parsed from the CMR and an OGC
 * collectionId parameter return the full variables which match.
 *
 * @param eosdisCollections - An array of collections
 * @param collectionIdParam - The OGC collectionId query parameter
 * @returns an array of objects with a collectionId and list
 *   of variables e.g. `[{ collectionId: C123-PROV1, variables: [<Variable object>] }]`
 * @throws RequestValidationError - if the requested OGC collection ID parameter is not valid
 * based on the variables in the collections
 */
export default function parseVariables(
  eosdisCollections: CmrCollection[],
  collectionIdParam: string,
): VariableInfo[] {
  // Note that "collectionId" from the Open API spec is an OGC API Collection, which is
  // what we would call a variable (or sometimes a named group of variables).  In the
  // OpenAPI spec doc, a "collection" refers to a UMM-Var variable, and a "CMR collection" refers
  // to a UMM-C collection.  In the code, wherever possible, collections are UMM-C collections
  // and variables are UMM-Var variables.  The following line is the confusing part where we
  // translate between the two nomenclatures.
  const variableIds = collectionIdParam.split(',');
  const variableInfo = [];

  if (variableIds.indexOf('all') !== -1) {
    // If the variable ID is "all" do not subset by variable
    if (variableIds.length !== 1) {
      throw new RequestValidationError('"all" cannot be specified alongside other variables');
    }
    for (const collection of eosdisCollections) {
      variableInfo.push({ collectionId: collection.id });
    }
  } else {
    // Figure out which variables belong to which collections and whether any are missing.
    // Note that a single variable name may appear in multiple collections
    let missingVariables = variableIds;
    for (const collection of eosdisCollections) {
      const variables = [];
      for (const variableId of variableIds) {
        const variable = collection.variables.find((v) => doesPathMatch(v, variableId));
        if (variable) {
          missingVariables = missingVariables.filter((v) => v !== variableId);
          variables.push(variable);
        }
      }
      variableInfo.push({ collectionId: collection.id, variables });
    }
    if (missingVariables.length > 0) {
      throw new RequestValidationError(`Coverages were not found for the provided CMR collection: ${missingVariables.join(', ')}`);
    }
  }
  return variableInfo;
}
