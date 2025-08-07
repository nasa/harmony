import * as fs from 'fs';
import path from 'path';

let serviceIDToCanonicalNameMap;

/**
 * Parses the harmony env-defaults file for services and creates a map of service IDs to
 * service names
 * @returns a Map of service IDs to canonical service names
 */
async function parseHarmonyEnvDefaults(): Promise<Map<string, string>> {
  if (!serviceIDToCanonicalNameMap) {
    serviceIDToCanonicalNameMap = new Map<string, string>();
    // Get the directory where this TypeScript file is located
    const currentDir = path.dirname(__filename);

    const filePath = path.join(currentDir, '../../../harmony/env-defaults');
    const data = await fs.promises.readFile(filePath, 'utf8');
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
export async function serviceIDToCanonicalServiceName(serviceID: string): Promise<string> {
  // remove the tag (if any) and repository (if any) from the serviceID
  const withoutTag = serviceID.split(':')[0];
  const match = withoutTag.match(/^.+\/(.+)/);
  const service = match ? match[1] : withoutTag;
  return (await parseHarmonyEnvDefaults())[service];
}