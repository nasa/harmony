import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookVersions } from './helpers/versions';

describe('Versions endpoint', function () {
  hookServersStartStop();

  describe('when hitting the versions endpoint', function () {
    hookVersions();

    it('returns a 200 success', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns a JSON response', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns a listing of all of the argo services from services.yml', function () {
      const services = JSON.parse(this.res.text);
      expect(services.map((s) => s.name)).to.eql([
        'asfdataservices/gdal-subsetter',
        'harmony/gdal',
        'podaac/l2-subsetter',
        'ds/swot-reproject',
        'sds/variable-subsetter',
        'harmony/chaining-example',
        'podaac/ps3',
        'podaac/netcdf-converter',
        'harmony/netcdf-to-zarr',
      ]);
    });

    it('includes a name, image, tag, and imagePullPolicy fields for each service', function () {
      const services = JSON.parse(this.res.text);
      for (const service of services) {
        expect(Object.keys(service)).to.eql(['name', 'image', 'tag', 'image_pull_policy']);
      }
    });
  });
});
