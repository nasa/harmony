/**
 * Get a list of all the services for the specified environment from the umm_s field in
 * services.yml and compare each record in services.yml to the UMM-S record in CMR noting
 * any mismatches between the configurations.
 */

import { exit } from 'process';
import { loadServiceConfigs } from '../services/harmony/app/models/services';
import { CmrUmmService, cmrApiConfig, getServicesByIds } from '../services/harmony/app/util/cmr';
import { ServiceConfig } from '../services/harmony/app/models/services/base-service';
import validation from 'ajv/dist/vocabularies/validation';

/**
 * Validates spatial subsetting configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateSpatialSubsetting(
  ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>,
): string {
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
function validateShapefileSubsetting(
  ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>,
): string {
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
function validateVariableSubsetting(
  ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>,
): string {
  const harmonyVariable = harmonyConfig.capabilities.subsetting.variable || false;
  const ummVariable = ummRecord.umm.ServiceOptions?.Subset?.VariableSubset ? true : false;
  if (harmonyVariable !== ummVariable) {
    return `Variable subset mismatch: harmony is ${harmonyVariable} and UMM-S is ${ummVariable}.`;
  }
  return '';
}

/**
 * Validates concatenation configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateConcatenation(
  ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>,
): string {
  const errors = [];
  const harmonyConcatenation = harmonyConfig.capabilities.concatenation || false;
  const ummConcatenation = ummRecord.umm?.ServiceOptions?.Aggregation?.Concatenate !== undefined;
  if (harmonyConcatenation !== ummConcatenation) {
    errors.push(`Concatenation mismatch: harmony is ${harmonyConcatenation} and UMM-S is ${ummConcatenation}.`);
  }
  const harmonyConcatenateByDefault = harmonyConfig.capabilities.concatenate_by_default || false;
  const ummConcatenateDefault = ummRecord.umm?.ServiceOptions?.Aggregation?.Concatenate?.ConcatenateDefault || false;
  if (ummConcatenateDefault !== harmonyConcatenateByDefault) {
    errors.push(`Concatenate by default mismatch: harmony is ${harmonyConcatenateByDefault} and UMM-S is ${ummConcatenateDefault}.`);
  }
  return errors.join(' ');
}

/**
 * Validates reprojection configuration matches
 *
 * @param ummRecord - The UMM-S record
 * @param harmonyConfig - The service configuration defined in harmony services.yml
 * @returns validation failure message or '' if validation succeeds
 */
function validateReprojection(
  ummRecord: CmrUmmService, harmonyConfig: ServiceConfig<unknown>,
): string {
  const harmonyReprojection = harmonyConfig.capabilities.reprojection || false;
  const ummReprojection = ummRecord.umm.ServiceOptions?.SupportedOutputProjections ? true : false;
  if (harmonyReprojection !== ummReprojection) {
    return `Reprojection mismatch: harmony is ${harmonyReprojection} and UMM-S is ${ummReprojection}.`;
  }
  return '';
}

export const allValidations = [
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
  let exitCode = 0;
  for (const environment of environments) {
    console.log(`*** Running service comparison for ${environment}`);
    cmrApiConfig.useToken = false;
    cmrApiConfig.baseURL = environment;
    const harmonyServiceConfigs = loadServiceConfigs(environment)
      .filter((config) => config.umm_s); // Ignore any service definitions that do not point to a UMM-S record
    const ummConceptIds = harmonyServiceConfigs.map((config) => config.umm_s);
    const ummRecords = await getServicesByIds(ummConceptIds, null);
    const ummRecordsMap = createUmmRecordsMap(ummRecords);
    for (const harmonyConfig of harmonyServiceConfigs) {
      const ummRecord = ummRecordsMap[harmonyConfig.umm_s];
      const validationMessages = performValidations(ummRecord, harmonyConfig);
      if (validationMessages.length > 0) {
        // For SAMBAH we're allowing for a difference in concatenate_by_default since for API
        // users they want that to be false, but in EDSC they want the default to be to have the
        // box checked.
        if (harmonyConfig.name == 'l2-subsetter-batchee-stitchee-concise') {
          // only _warn_ about concatenate by default difference - other messages are actual errors
          const failureMessages = validationMessages.reduce((acc, message) => {
            if (message != 'Concatenate by default mismatch: harmony is false and UMM-S is true.') {
              acc.push(message);
            } else {
              console.log(`WARNING: ${harmonyConfig.name} and ${ummRecord.meta['concept-id']} differ:\n    - ${message}`);
            }
            return acc;
          }, []);

          if (failureMessages.length > 0) {
            exitCode = 1;
            console.log(`ERROR: Validation failures for ${harmonyConfig.name} and ${ummRecord.meta['concept-id']}:\n    - ${failureMessages.join('\n    - ')}`);
          }
        } else {
          exitCode = 1;
          console.log(`ERROR: Validation failures for ${harmonyConfig.name} and ${ummRecord.meta['concept-id']}:\n    - ${validationMessages.join('\n    - ')}`);
        }
      }
    }
  }
  if (exitCode === 0) {
    console.log('No validation failures found.');
  }
  exit(exitCode);
}

/**
 * Main function called from npm run compare-services
 */
async function main(): Promise<void> {
  await runComparisons();
}

if (require.main === module) {
  void main();
}