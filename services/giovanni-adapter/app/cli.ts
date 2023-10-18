import yargs from 'yargs';
import DataOperation from '../../harmony/app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../harmony/app/util/crypto';
import logger from '../../harmony/app/util/log';
import Catalog from './stac/catalog';
import StacItem from './stac/item';
import { BoundingBox } from '../../harmony/app/util/bounding-box';
import { resolve } from '../../harmony/app/util/url';
import { objectStoreForProtocol } from '../../harmony/app/util/object-store';

// giovanni globals
import giovanniDatafieldConfig from '../config/giovanni-datafield.json';

interface HarmonyArgv {
  harmonyMetadataDir?: string;
  harmonyInput?: object;
}

/**
 * Builds and returns the CLI argument parser
 * @returns the CLI argument parser
 */
export function parser(): yargs.Argv<unknown> {
  return yargs
    .usage('Usage: --harmony-metadata-dir <dir> --harmony-input <message>')
    .option('harmony-metadata-dir', {
      alias: 'o',
      describe: 'the directory where output files should be placed',
      type: 'string',
      demandOption: true,
    })
    .option('harmony-input', {
      alias: 'i',
      describe: 'the JSON-formatted input message from Harmony',
      type: 'string',
      coerce: JSON.parse,
      demandOption: true,
    });
}

/**
 * Removes trailing .000Z milliseconds from RFC3339 string times
 *
 * @param rfc3339DateString - the date time string formatted as RFC3339
 * @returns the date time string without milliseconds and Z since RFC3339 is not supported by
 * Giovanni
 */
function removeMillisecondsFromRFC3339(rfc3339DateString: string): string {
  const regex = /\.\d{3}Z$/;
  return rfc3339DateString.replace(regex, '');
}

/**
 * Generate Giovanni URL.
 * @param operation - The operation
 * @param cmrEndpoint - CMR endpoint; needs to be one of the following from environments:
 *  https://cmr.earthdata.nasa.gov
 *  https://cmr.uat.earthdata.nasa.gov
 */
async function _generateGiovanniURL(
  operation: DataOperation, cmrEndpoint: string,
): Promise<{ giovanniUrl: string; giovanniUrlTitle: string }> {
  let giovanniBaseUrl;
  if ( cmrEndpoint === 'https://cmr.earthdata.nasa.gov' ) {
    giovanniBaseUrl = 'https://api.giovanni.earthdata.nasa.gov/';
  } else if ( cmrEndpoint === 'https://cmr.uat.earthdata.nasa.gov' ) {
    giovanniBaseUrl = 'https://api.giovanni.uat.earthdata.nasa.gov/';
  } else {
    throw new Error('CMR_ENDPOINT not set correctly.');
  }

  const giovanniServiceName = 'proxy-timeseries';
  const timeStart = operation.temporal.start;
  const timeEnd = operation.temporal.end;
  const [lon, lat] = operation.spatialPoint;
  const collectionId = operation.model.sources[0].collection;
  const variableId = operation.model.sources[0].variables[0].id;
  const giovanniDatafield = giovanniDatafieldConfig[cmrEndpoint][collectionId][variableId];
  const giovanniLocationParam = encodeURIComponent(`[${lat},${lon}]`);
  const giovanniTimeParam = encodeURIComponent(`${removeMillisecondsFromRFC3339(timeStart)}/${removeMillisecondsFromRFC3339(timeEnd)}`);
  const giovanniUrlPath = `${giovanniServiceName}?data=${giovanniDatafield}&location=${giovanniLocationParam}&time=${giovanniTimeParam}`;
  return {
    giovanniUrl: `${giovanniBaseUrl}${giovanniUrlPath}`,
    giovanniUrlTitle: `Giovanni URL for time series of variable ${giovanniDatafield} \
(latitude = ${lat}, longitude = ${lon}, time range = [${timeStart}, ${timeEnd}])`,
  };
}

/**
 * Entrypoint which does environment and CLI parsing.  Run `ts-node .` for usage.
 * @param args - The command line arguments to parse, absent any program name
 */
export default async function main(args: string[]): Promise<void> {
  const startTime = new Date().getTime();
  const appLogger = logger.child({ application: 'giovanni-adapter' });
  const options = parser().parse(args) as HarmonyArgv;
  const encrypter = createEncrypter(process.env.SHARED_SECRET_KEY);
  const decrypter = createDecrypter(process.env.SHARED_SECRET_KEY);
  const operation = new DataOperation(options.harmonyInput, encrypter, decrypter);
  const timingLogger = appLogger.child({ requestId: operation.requestId });
  timingLogger.info('timing.giovanni-adapter.start');

  // generate Giovanni URL
  const cmrEndpoint = process.env.CMR_ENDPOINT;
  const { giovanniUrl, giovanniUrlTitle } = await _generateGiovanniURL(operation, cmrEndpoint);

  // set up stac catalog
  const result = new Catalog({ description: 'Giovanni adapter service' });

  // generate stac item
  const stacItemRelativeFilename = 'item.json';
  result.links.push({
    'rel': 'item',
    'href': stacItemRelativeFilename,
    'type': 'application/json',
    'title': 'giovanni stac item',
  });
  const stacItemUrl = resolve(options.harmonyMetadataDir, stacItemRelativeFilename);
  const timeStart = operation.temporal.start;
  const timeEnd = operation.temporal.end;
  const properties = { start_datetime: timeStart, end_datetime: timeEnd };
  const [lon, lat] = operation.spatialPoint;
  const bbox: BoundingBox = [lon, lat, lon, lat];
  const assets = {
    'Giovanni URL': {
      href: giovanniUrl,
      title: giovanniUrlTitle,
      description: 'Giovanni link',
      type: 'text/csv',
      roles: ['data'],
    },
  };
  const item = new StacItem({
    properties,
    bbox,
    assets,
  });
  await item.write(stacItemUrl, true);

  // save stac catalog
  const relativeFilename = 'catalog.json';
  const catalogFilenames = [];
  const catalogUrl = resolve(options.harmonyMetadataDir, relativeFilename);
  catalogFilenames.push(relativeFilename);
  await result.write(catalogUrl, true);

  const catalogListUrl = resolve(options.harmonyMetadataDir, 'batch-catalogs.json');
  const catalogCountUrl = resolve(options.harmonyMetadataDir, 'batch-count.txt');

  const s3 = objectStoreForProtocol('s3');
  await s3.upload(JSON.stringify(catalogFilenames), catalogListUrl, null, 'application/json');
  await s3.upload(catalogFilenames.length.toString(), catalogCountUrl, null, 'text/plain');

  const durationMs = new Date().getTime() - startTime;
  timingLogger.info('timing.giovanni-adapter.end', { durationMs });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e); // eslint-disable-line no-console
    throw (e);
  });
}
