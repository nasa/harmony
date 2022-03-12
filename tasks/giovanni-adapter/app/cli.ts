import yargs from 'yargs';
import { promises as fs } from 'fs';
import path from 'path';
import DataOperation from '../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../app/util/crypto';
import logger from '../../../app/util/log';
import Catalog from './stac/catalog';
import StacItem from './stac/item';
import { BoundingBox } from '../../../app/util/bounding-box';

// giovanni globals
import giovanni_datafield_config from '../config/giovanni-datafield.json';
const giovanni_base_url = 'https://api.giovanni.earthdata.nasa.gov/';

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
  timingLogger.info('timing..start');

  // generate Giovanni URL
  const giovanni_service_name = 'proxy-timeseries';
  const time_start = operation.temporal.start;
  const time_end = operation.temporal.end;
  const [lon, lat] = operation.spatialPoint;
  const collectionId = operation.model.sources[0].collection;
  const variableId = operation.model.sources[0].variables[0].id;
  const giovanni_datafield = giovanni_datafield_config[collectionId][variableId];
  const giovanni_location_param = encodeURIComponent(`[${lat},${lon}]`);
  const giovanni_time_param = encodeURIComponent(`${time_start}/${time_end}`);
  const giovanni_url_path = `${giovanni_service_name}?data=${giovanni_datafield}&location=${giovanni_location_param}&time=${giovanni_time_param}`;
  const giovanni_url = `${giovanni_base_url}${giovanni_url_path}`;

  // set up stac catalog
  await fs.mkdir(options.harmonyMetadataDir, { recursive: true });
  const result = new Catalog({ description: 'Giovanni adapter service' });
  /*
  result.links.push({
    rel: 'harmony_source',
    href: `${process.env.CMR_ENDPOINT}/search/concepts/${source.collection}`,
  });
  */

  // generate stac item
  const stacItemRelativeFilename = 'item.json';
  result.links.push({
    'rel': 'item',
    'href': stacItemRelativeFilename,
    'type': 'application/json',
    'title': 'giovanni stac item',
  });
  const stacItemFilename = path.join(options.harmonyMetadataDir, stacItemRelativeFilename);
  const bbox: BoundingBox = [lon, lat, lon, lat];
  const assets = {
    'Giovanni URL': {
      href: giovanni_url,
      title: 'Giovanni',
      description: 'Giovanni link',
      type: 'data',
      roles: ['data'],
    },
  };
  const item = new StacItem({
    bbox,
    assets,
  });
  item.write(stacItemFilename, true);

  // save stac catalog
  const relativeFilename = 'catalog.json';
  const catalogFilenames = [];
  const filename = path.join(options.harmonyMetadataDir, relativeFilename);
  catalogFilenames.push(relativeFilename);
  result.write(filename, true);

  const catalogListFilename = path.join(options.harmonyMetadataDir, 'batch-catalogs.json');
  const catalogCountFilename = path.join(options.harmonyMetadataDir, 'batch-count.txt');

  await fs.writeFile(catalogListFilename, JSON.stringify(catalogFilenames));
  await fs.writeFile(catalogCountFilename, catalogFilenames.length.toString());

  const durationMs = new Date().getTime() - startTime;
  timingLogger.info('timing.giovanni-adapter.end', { durationMs });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e); // eslint-disable-line no-console
    throw (e);
  });
}
