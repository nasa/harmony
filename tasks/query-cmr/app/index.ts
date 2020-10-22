import yargs from 'yargs';
import { promises as fs } from 'fs';
import path from 'path';
import DataOperation from '../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../app/util/crypto';
import env from '../../../app/util/env';

import query from './query-granules';

/**
 * Entrypoint which does environment and CLI parsing.  Run `ts-node .` for usage.
 * @param args - The command line arguments to parse, absent any program name
 */
export default async function main(args: string[]): Promise<void> {
  const options = yargs(args)
    .usage('Usage: --output-dir <dir> --harmony-input <message> --query <query1> <query2>')
    .command('query-cmr', 'Query the CMR, producing one file of source granules per page')
    .option('o', {
      alias: 'output-dir',
      describe: 'the directory where output files should be placed',
      type: 'string',
      demandOption: true,
    })
    .option('i', {
      alias: 'harmony-input',
      describe: 'the JSON-formatted input message from Harmony',
      type: 'string',
      coerce: JSON.parse,
      demandOption: true,
    })
    .option('q', {
      alias: 'query',
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
    })
    .argv;

  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(options.harmonyInput, encrypter, decrypter);
  await fs.mkdir(options.outputDir, { recursive: true });
  const results = await query(
    operation,
    options.query,
    options.outputDir,
    options.pageSize,
    options.maxPages,
  );
  const filename = path.join(options.outputDir, 'index.json');
  await fs.writeFile(filename, JSON.stringify(results), 'utf8');
}

if (require.main === module) {
  main(process.argv.slice(2));
}
