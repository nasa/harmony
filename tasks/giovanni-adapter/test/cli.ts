import { expect } from 'chai';
import { describe, it } from 'mocha';
import fs from 'fs';
import tmp from 'tmp';
import path from 'path';

import { hookCliParser, hookCliMain } from './helpers/cli';

describe('cli', function () {
  describe('parser', function () {
    describe('--help', function () {
      hookCliParser('--help');

      it('outputs a usage message', async function () {
        expect(this.output).to.match(/^Usage: /);
      });

      it('does not produce an error', async function () {
        expect(this.error).to.equal(undefined);
      });
    });

    describe('--harmony-metadata-dir', function () {
      hookCliParser('--harmony-input', '{}');
      describe('when not provided', function () {
        it('produces a missing argument error', function () {
          expect(this.error.message).to.equal('Missing required argument: harmony-metadata-dir');
        });
      });

      describe('when provided', function () {
        hookCliParser('--harmony-metadata-dir', 'temp', '--harmony-input', '{}');

        it('does not produce an error', function () {
          expect(this.error).to.equal(null);
        });

        it('parses the next argument as a string', function () {
          expect(this.argv.harmonyMetadataDir).to.equal('temp');
        });
      });
    });

    describe('--harmony-input', function () {
      describe('when not provided', function () {
        hookCliParser('--harmony-metadata-dir', 'temp');
        it('produces a missing argument error', function () {
          expect(this.error.message).to.equal('Missing required argument: harmony-input');
        });
      });

      describe('when provided', function () {
        hookCliParser('--harmony-metadata-dir', 'temp', '--harmony-input', { hello: 'world' });

        it('does not produce an error', function () {
          expect(this.error).to.equal(null);
        });

        it('parses the next argument as a JSON object', function () {
          expect(this.argv.harmonyInput).to.eql({ hello: 'world' });
        });
      });
    });
  });

  describe('main', function () {
    const input = `{
      "sources":[
         {
            "collection":"C1225808238-GES_DISC",
            "variables":[
               {
                  "id":"V1242222340-GES_DISC",
                  "name":"/Grid/IRprecipitation",
                  "fullPath":"/Grid/IRprecipitation"
               }
            ]
         }
      ],
      "subset":{
         "point":[
            0.76,
            -3.8
         ]
      },
      "temporal":{
         "start":"2020-01-01T00:00:00.000Z",
         "end":"2020-01-01T03:00:00.000Z"
      }
   }`;
    describe('when the output directory exists', function () {
      const tmpDir = tmp.dirSync({ unsafeCleanup: true }).name;
      hookCliMain(
        ['--harmony-metadata-dir', tmpDir, '--harmony-input', input],
      );

      it('outputs the result data to catalog.json in the directory', function () {
        const index = path.join(tmpDir, 'catalog.json');
        expect(fs.existsSync(index)).to.be.true;
        expect(JSON.parse(fs.readFileSync(index, 'utf-8')).description).to.equal('Giovanni adapter service');
      });
    });

    describe('when the output directory does not exist', function () {
      const tmpDir = tmp.tmpNameSync();
      hookCliMain(
        ['--harmony-metadata-dir', tmpDir, '--harmony-input', input],
      );
      after(() => fs.rmdirSync(tmpDir, { recursive: true }));

      it('creates the directory and one catalog file for each returned catalog', function () {
        const catalog = path.join(tmpDir, 'catalog.json');
        expect(fs.existsSync(catalog)).to.be.true;
        expect(JSON.parse(fs.readFileSync(catalog, 'utf-8')).description).to.equal('Giovanni adapter service');
      });
    });
  });
});
