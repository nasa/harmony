import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getObjectText } from '../../../test/helpers/object-store';

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
      const tmpDir = 's3://stac/abc/123/outputs/';
      hookCliMain(
        ['--harmony-metadata-dir', tmpDir, '--harmony-input', input],
      );

      it('outputs the result data to catalog.json in the directory', async function () {
        const catalog = await getObjectText(`${tmpDir}/catalog.json`);
        expect(JSON.parse(catalog).description).to.equal('Giovanni adapter service');
      });

      it('outputs the result data to item.json in the directory', async function () {
        const itemContext = JSON.parse(await getObjectText(`${tmpDir}/item.json`));
        expect(itemContext.bbox).to.eql([ 0.76, -3.8, 0.76, -3.8 ]);
        expect(itemContext.properties.start_datetime).to.equal('2020-01-01T00:00:00.000Z');
        expect(itemContext.properties.end_datetime).to.equal('2020-01-01T03:00:00.000Z');
        expect(itemContext.assets['Giovanni URL'].href).to.equal('https://api.giovanni.uat.earthdata.nasa.gov/proxy-timeseries?data=GPM_3IMERGHH_06_precipitationCal&location=%5B-3.8%2C0.76%5D&time=2020-01-01T00%3A00%3A00.000Z%2F2020-01-01T03%3A00%3A00.000Z');
        expect(itemContext.assets['Giovanni URL'].title).to.equal('Giovanni URL for time series of variable GPM_3IMERGHH_06_precipitationCal (latitude = -3.8, longitude = 0.76, time range = [2020-01-01T00:00:00.000Z, 2020-01-01T03:00:00.000Z])');
      });
    });
  });
});
