/**
 * Get a list of all the services for the specified environment from the umm_s field in
 * services.yml and compare each record in services.yml to the UMM-S record in CMR noting
 * any mismatches between the configurations.
 */

import { exit } from 'process';
import { loadServiceConfigs } from '../app/models/services';
import { CmrUmmService, cmrApiConfig, getServicesByIds } from '../app/util/cmr';
import { ServiceConfig } from '../app/models/services/base-service';

// Functions I expect to need
// Get all service configurations from services.yml for a given environment
// Get a list of warnings/config differences between a single service definition and the UMM-S record
// Data structure with each field in services.yml that should be checked as a key and a link to the UMM-S field that should be checked as the value
// Field specific functions for each comparison
// A generic validation function that can handle each field specific function providing back mismatches
// A list of validation functions

// Add all the validation function definitions here

/**
 * Validates spatial subsetting configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateSpatialSubsetting(ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>): string {
  const harmonyBbox = harmonyConfig.capabilities.subsetting.bbox || false;
  const ummBbox = ummRecord.umm.ServiceOptions?.Subset?.SpatialSubset?.BoundingBox ? true : false;
  if (harmonyBbox !== ummBbox) {
    return `Bounding box subset mismatch: harmony is ${harmonyBbox} and UMM-S is ${ummBbox}.`;
  }
  return '';
}

/**
 * Validates shapefile subsetting configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateShapefileSubsetting(ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>): string {
  const harmonyShapefile = harmonyConfig.capabilities.subsetting.shape || false;
  const ummShapefile = ummRecord.umm.ServiceOptions?.Subset?.SpatialSubset?.Shapefile ? true : false;
  if (harmonyShapefile !== ummShapefile) {
    return `Shapefile subset mismatch: harmony is ${harmonyShapefile} and UMM-S is ${ummShapefile}.`;
  }
  return '';
}

/**
 * Validates variable subsetting configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateVariableSubsetting(ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>): string {
  return '';
}

/**
 * Validates concatenation configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateConcatenation(_ummRecord: CmrUmmService, _harmonyConfig: ServiceConfig<unknown>): string {
  return '';
}

/**
 * Validates reprojection configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateReprojection(ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>): string {
  return '';
}

const allValidations = [
  validateSpatialSubsetting,
  validateShapefileSubsetting,
  validateVariableSubsetting,
  validateConcatenation,
  validateReprojection,
];

/**
 * Performs all of the validations for the given UMM-S record and harmony service configuration
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @param validationFunctions - the validation functions to perform
 * @returns a list of validation failure messages
 */
function performValidations(ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>, validationFunctions = allValidations): string[] {
  const validationMessages = [];
  for (const validationFn of validationFunctions) {
    const validationMessage = validationFn(ummRecord, harmonyConfig);
    if (validationMessage) {
      validationMessages.push(validationMessage);
    }
  }
  return validationMessages;
}

/**
 * Creates a map of concept ID to UMM-S record
 * @param ummRecords - an array of UMM-S records
 */
function createUmmRecordsMap(ummRecords: CmrUmmService[]): { [key: string]: CmrUmmService } {
  return ummRecords.reduce((allRecords, ummRecord) => {
    const conceptId = ummRecord.meta['concept-id'];
    allRecords[conceptId] = ummRecord;
    return allRecords;
  }, {});
}


const allEnvironments = ['https://cmr.earthdata.nasa.gov', 'https://cmr.uat.earthdata.nasa.gov'];

/**
 * Runs the service comparison reporting any validation messages. If there are any errors print them out
 * and exit with a non-zero exit code.
 *
 * @param environments - the CMR environments to check against
 */
async function runComparisons(environments = allEnvironments): Promise<void> {
  // Note should be able to use an existing config
  let exitCode = 0;
  for (const environment of environments) {
    console.log(`*** Running service comparison for ${environment}`);
    cmrApiConfig.useToken = false;
    cmrApiConfig.baseURL = environment;
    const harmonyServiceConfigs = loadServiceConfigs(environment);
    const ummConceptIds = harmonyServiceConfigs.map((config) => config.umm_s);
    const ummRecords = await getServicesByIds(ummConceptIds, null);
    const ummRecordsMap = createUmmRecordsMap(ummRecords);
    for (const harmonyConfig of harmonyServiceConfigs) {
      const ummRecord = ummRecordsMap[harmonyConfig.umm_s];
      const validationMessages = performValidations(ummRecord, harmonyConfig);
      if (validationMessages.length > 0) {
        exitCode = 1;
        console.log(`Validation failures for ${harmonyConfig.name} and ${ummRecord.meta['concept-id']}:\n    - ${validationMessages.join('\n    - ')}`);
      }
    }
  }
  exit(exitCode);
}

/**
 * Main function called from npm run service-compare
 */
async function main(): Promise<void> {
  await runComparisons();
}

if (require.main === module) {
  void main();
}