import yargs from 'yargs';
import { promises as fs } from 'fs';
import path from 'path';
import DataOperation from '../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../app/util/crypto';
import env from '../../../app/util/env';

import { queryGranules } from './query';

interface HarmonyArgv {
  outputDir?: string;
  harmonyInput?: object;
  query?: (string | number)[];
  pageSize?: number;
  maxPages?: number;
}
/**
 * Builds and returns the CLI argument parser
 * @returns the CLI argument parser
 */
export function parser(): yargs.Argv<HarmonyArgv> {
  return yargs
    .usage('Usage: --output-dir <dir> --harmony-input <message> --query <query1> <query2>')
    .option('output-dir', {
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
    })
    .option('query', {
      alias: 'q',
      describe: 'file locations containing the CMR query to be performed, one per message source',
      type: 'array',
      demandOption: true,
    })
    .option('page-size', {
      describe: 'the size of each page of results provided',
      type: 'number',
      default: 2000,
    })
    .option('max-pages', {
      describe: 'the maximum number of pages to provide per source',
      type: 'number',
      default: 1,
    });
}

/**
 * Entrypoint which does environment and CLI parsing.  Run `ts-node .` for usage.
 * @param args - The command line arguments to parse, absent any program name
 */
export default async function main(args: string[]): Promise<void> {
  const options = parser().parse(args);
  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(options.harmonyInput, encrypter, decrypter);
  await fs.mkdir(options.outputDir, { recursive: true });
  const results = await queryGranules(
    operation,
    options.query as string[],
    options.outputDir,
    options.pageSize,
    options.maxPages,
  );
  const filename = path.join(options.outputDir, 'index.json');
  await fs.writeFile(filename, JSON.stringify(results), 'utf8');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
  });
}
