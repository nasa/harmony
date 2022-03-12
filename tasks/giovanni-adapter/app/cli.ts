import yargs from 'yargs';
import { promises as fs } from 'fs';
import path from 'path';
import DataOperation from '../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../app/util/crypto';
import logger from '../../../app/util/log';
import Catalog from './stac/catalog';
import StacItem from './stac/item';
import { BoundingBox } from '../../../app/util/bounding-box';

const giovanni_datafield_config = require('../config/giovanni-datafield.json');
const giovanni_base_url = "https://api.giovanni.earthdata.nasa.gov/";

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
    .usage('Usage: --output-dir <dir> --harmony-input <message> [--query <query1> <query2>]')
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
  console.log("ZHL got operation: ", operation);
  console.log("config: ",giovanni_datafield_config);
  console.log("ZHL got operation model source: ", operation.model.sources);
  console.log("ZHL got operation model var source: ", operation.model.sources[0].variables);
  const timingLogger = appLogger.child({ requestId: operation.requestId }); // I can use my own logger but has to be consistent with the current format
  timingLogger.info('timing..start');
  await fs.mkdir(options.harmonyMetadataDir, { recursive: true });
  //await new Promise(r => setTimeout(r, 2000000));

  const result = new Catalog({ description: 'Giovanni adapter service' });
  // Get collection short name (make sure it's a conception id)
  // e.g. curl -Ln -bj “https://cmr.earthdata.nasa.gov/search/collections.json?concept_id=C1214614210-SCIOPS” | jq .
  https://api.giovanni.earthdata.nasa.gov/timeseries?data=GPM_3IMERGHH_06_precipitationCal&location=%5B4.75%2C0.55%5D&time=2000-06-01T00:00:00%2F2000-06-01T07:30:00"
  /*
  result.links.push({
    rel: 'harmony_source',
    href: `${process.env.CMR_ENDPOINT}/search/concepts/${source.collection}`,
  });
  */
  result.links.push({
      "rel": "item",
      //"href": "<uuid>/<same uuid>.json", //<uuid>/<same uuid>.json saves the stac item which will have giovanni url under assets (which is the only thing that is required)
      "href": "item.json",
      "type": "application/json",
      "title": "001_00_7f00ff_global"
  });
  console.log("ZHL result: ",result);

  const giovanni_service_name = 'proxy-timeseries';
  const time_start = operation.temporal.start;
  const time_end = operation.temporal.end;
  const [lon, lat] = operation.spatialPoint;
  const bbox: BoundingBox = [
      lon,
      lat,
      lon,
      lat
  ];
  const collectionId = operation.model.sources[0].collection;
  const variableId = operation.model.sources[0].variables[0].id;
  const giovanni_datafield = giovanni_datafield_config[collectionId][variableId];
  const giovanni_url_path = encodeURIComponent(`${giovanni_service_name}?data=${giovanni_datafield}&location=[${lat},${lon}]&time=${time_start}/${time_end}`);
  const giovanni_url = `${giovanni_base_url}${giovanni_url_path}`;
  const assets = {
    "Giovanni URL": {
      href: giovanni_url,
      title: "Giovanni",
      description: "Giovanni link",
      type: "data",
      roles: ['data']
    }
  };



  const stacItemFilename = path.join(options.harmonyMetadataDir, 'item.json');
  const item = new StacItem({
    bbox,
    assets,
  });
  item.write(stacItemFilename, true);

  const relativeFilename = `catalog.json`;
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
