import { describe, it } from 'mocha';
import { expect } from 'chai';
import fileCheckSum from '../../app/util/file';

const testGeoJsonFileName = './test/resources/complex_multipoly.geojson';
// generated from linux's 'md5sum'
const testGeoJsonMD5Sum = 'c6202a55c5e1dd8ab20fa01a07e8094a';

describe('util/file', function () {
  describe('creating an MD5 sum', function () {
    it('it equals a known MD5 sum', async function () {
      const md5sum = await fileCheckSum(testGeoJsonFileName);
      expect(md5sum).to.equal(testGeoJsonMD5Sum);
    });
  });
});
