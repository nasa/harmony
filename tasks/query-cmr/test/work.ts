import { QueryCmrRequest } from './../app/routers/router';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import fs from 'fs';
import tmp from 'tmp';
import path from 'path';
import { hookDoWork } from './helpers/work';
import CmrStacCatalog from '../app/stac/cmr-catalog';

describe('doWork', function () {
  describe('main', function () {

    describe('when the output directory exists', function () {
      const tmpDir = tmp.dirSync({ unsafeCleanup: true }).name;
      const workRequest: QueryCmrRequest = {
        outputDir: tmpDir,

      };
      hookDoWork(
        workRequest,
        [new CmrStacCatalog({ description: 'done' })],
      );

      it('outputs the result data to catalog.json in the directory', function () {
        const index = path.join(tmpDir, 'catalog0.json');
        expect(fs.existsSync(index)).to.be.true;
        expect(JSON.parse(fs.readFileSync(index, 'utf-8')).description).to.equal('done');
      });
    });

    describe('when the output directory does not exist', function () {
      const tmpDir = tmp.tmpNameSync();
      const workRequest: QueryCmrRequest = {
        outputDir: tmpDir,

      };
      hookDoWork(
        workRequest,
        [new CmrStacCatalog({ description: 'first' }), new CmrStacCatalog({ description: 'second' })],
      );
      after(() => fs.rmSync(tmpDir, { recursive: true }));

      it('creates the directory and one catalog file for each returned catalog', function () {
        const firstCatalog = path.join(tmpDir, 'catalog0.json');
        const secondCatalog = path.join(tmpDir, 'catalog1.json');
        expect(fs.existsSync(firstCatalog)).to.be.true;
        expect(fs.existsSync(secondCatalog)).to.be.true;
        expect(JSON.parse(fs.readFileSync(firstCatalog, 'utf-8')).description).to.equal('first');
        expect(JSON.parse(fs.readFileSync(secondCatalog, 'utf-8')).description).to.equal('second');
      });
    });
  });
});

