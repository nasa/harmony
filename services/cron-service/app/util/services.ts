import * as fs from 'fs';
import path from 'path';

let serviceIDToCanonicalNameMap;

/**
 * Parses the harmony env-defaults file for services and creates a map of service IDs to
 * service names
 * @returns a Map of service IDs to canonical service names
 */
async function parseHarmonyEnvDefaults(envDefaultsPath: string): Promise<Map<string, string>> {
  if (!serviceIDToCanonicalNameMap) {
    serviceIDToCanonicalNameMap = new Map<string, string>();
    const data = await fs.promises.readFile(envDefaultsPath, 'utf8');
    const lines = data.split('\n');

    lines.forEach((line, _) => {
      const match = line.match(/^(.+)_IMAGE=(?:[^\/]+\/)*([^:]+)(?::.+)?$/);
      if (match) {
        const upcaseName = match[1];
        const serviceID = match[2];
        const canonicalName = upcaseName.toLowerCase().replace(/_/g, '-');
        serviceIDToCanonicalNameMap[serviceID] = canonicalName;
      }
    });
  }

  return serviceIDToCanonicalNameMap;
}

/**
 *
 * @param serviceID - The service ID as used in the work-items table (possibly including tag)
 * @returns The canonical name for the service as used in LOCALLY_DEPLOYED_SERVICES
 */
export async function serviceIDToCanonicalServiceName(serviceID: string, envDefaultsPath?: string): Promise<string> {
  // remove the tag (if any) and repository (if any) from the serviceID
  const withoutTag = serviceID.split(':')[0];
  const match = withoutTag.match(/^.+\/(.+)/);
  const service = match ? match[1] : withoutTag;
  let envDefaultsActualPath = envDefaultsPath;
  if (!envDefaultsActualPath) {
    // Get the directory where this TypeScript file is located
    const currentDir = path.dirname(__filename);
    envDefaultsActualPath = path.join(currentDir, '../../../harmony/env-defaults');
  }
  return (await parseHarmonyEnvDefaults(envDefaultsActualPath))[service];
}