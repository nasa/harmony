import fs, { promises } from 'fs';
import path from 'path';
import sinon, { SinonStub } from 'sinon';

import main, { parser } from '../../app/cli';
import * as query from '../../app/query';

/**
 * Converts CLI arguments to a command-line string.
 * DO NOT DEPLOY.  For testing only.  Importantly does not deal with environment variables or
 * shell expressions
 *
 * @param args command line arguments to convert
 * @returns the arguments converted to a string
 */
export function argsToString(...args): string {
  return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

export interface ParseResult {
  error: string;
  argv: {
    outputDir: string;
    // Harmony message validated by JSON Schema and not defined as a type
    harmonyInput: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    query: string[];
    pageSize: number;
    maxPages: number;
  };
  output: string;
}

/**
 * Parses the provided command line arguments into a ParseResult object. Does not reject
 * or exit the process if there is a failure but places the error into the "error" field.
 * @param args the arguments to parse
 * @returns the parse result containing errors, output, and/or parsed arguments
 */
export async function parse(...args): Promise<ParseResult> {
  return new Promise((resolve) => {
    const argString = argsToString(...args);
    parser().exitProcess(false).parse(argString, (error, argv, output) => {
      resolve({ error, argv, output });
    });
  });
}

/**
 * Adds before/after hooks that pass the args into the CLI and store the result in this.error,
 * this.argv, and this.output
 *
 * @param {string} collection The CMR Collection ID to query
 * @param {string} version The OGC API - Coverages version to use
 * @returns {void}
 */
export function hookCliParser(...args): void {
  before(async function () {
    const parsed = await parse(...args);
    this.error = parsed.error;
    this.argv = parsed.argv;
    this.output = parsed.output;
  });

  after(function () {
    delete this.error;
    delete this.argv;
    delete this.output;
  });
}

/**
 * Stubs the queryGranules method and calls cli.main with the given args, unlinking
 * the written output file.  Does not delete any created directories
 *
 * @returns {string} The URL prefix for use in matching responses
 */
export function hookCliMain(args, output): void {
  let outputDir = null;
  before(async function () {
    sinon.stub(query, 'queryGranules').callsFake((...callArgs) => {
      this.callArgs = callArgs;
      return Promise.resolve(output);
    });
    sinon.spy(promises, 'mkdir');

    outputDir = args[args.indexOf('--output-dir') + 1];
    await main(args);
  });
  after(function () {
    if (this.callArgs) {
      const indexFile = path.join(outputDir, 'index.json');
      if (fs.existsSync(indexFile)) {
        fs.unlinkSync(indexFile);
      }
      delete this.callArgs;
    }
    (promises.mkdir as SinonStub).restore();
    (query.queryGranules as SinonStub).restore();
  });
}
