import { expect } from 'chai';
import request from 'supertest';

import hookServersStartStop from './helpers/servers';

const serviceImages = {
  'service-runner': 'harmonyservices/service-runner:latest',
  'harmony-gdal-adapter': 'ghcr.io/nasa/harmony-gdal-adapter:latest',
  'hybig': 'ghcr.io/nasa/harmony-browse-image-generator:latest',
  'harmony-service-example': 'harmonyservices/service-example:latest',
  'harmony-netcdf-to-zarr': 'ghcr.io/nasa/harmony-netcdf-to-zarr:latest',
  'harmony-regridder': 'sds/harmony-regridder:latest',
  'swath-projector': 'ghcr.io/nasa/harmony-swath-projector:latest',
  'hoss': 'ghcr.io/nasa/harmony-opendap-subsetter:latest',
  'sds-maskfill': 'sds/maskfill-harmony:latest',
  'trajectory-subsetter': 'sds/trajectory-subsetter:latest',
  'podaac-concise': 'ghcr.io/podaac/concise:sit',
  'podaac-l2-subsetter': 'ghcr.io/podaac/l2ss-py:sit',
  'podaac-ps3': 'podaac/podaac-cloud/podaac-shapefile-subsetter:latest',
  'podaac-netcdf-converter': 'podaac/podaac-cloud/podaac-netcdf-converter:latest',
  'query-cmr': 'harmonyservices/query-cmr:latest',
  'giovanni-adapter': 'harmonyservices/giovanni-adapter:latest',
  'geoloco': 'ldds/geoloco:latest',
}

const errorMsg404 = 'Service foo does not exist.\nThe existing services and their images are\n' +
  JSON.stringify(serviceImages, null, 2);

describe('List service images', async function () {
  hookServersStartStop();

  before(async function() {
     this.res = await request(this.frontend).get('/service-image');
   });

   after(function() {
     delete this.res;
   });


  it('returns a map of images', async function () {
    expect(this.res.status).to.equal(200);  
    expect(this.res.body).to.eql(serviceImages);
  });
});

describe('Get service image', async function () {
  hookServersStartStop();

  describe('when the service does not exist', async function () {
    before(async function() {
      this.res = await request(this.frontend).get('/service-image/foo')
    });

    after(function() {
     delete this.res;
    });

    it('returns a status 404', async function() {
      expect(this.res.status).to.equal(404);
    });

    it('returns a meaningfule error message', async function() {
      expect(this.res.text).to.equal(errorMsg404);
    });

  });

  describe('when the service does exist', async function () {
    before(async function() {
      this.res = await request(this.frontend).get('/service-image/hoss')
    });

    after(function() {
     delete this.res;
    });

    it('returns a status 200', async function() {
      expect(this.res.status).to.equal(200);
    });

    it('returns the service image information', async function() {
      expect(this.res.body).to.eql({
        'image': 'ghcr.io/nasa/harmony-opendap-subsetter:latest',
      });
    });

  })

})

describe('Upate  service image', function() {
  hookServersStartStop();

  describe('when the service does not exist', async function() {
    before(async function() {
      this.res = await request(this.frontend).put('/service-image/foo');

    });

    after(function() {
      delete this.res;
    });

    it('returns a status 404', async function() {
      expect(this.res.status).to.equal(404);
    });

    it('returns a meaningfule error message', async function() {
      expect(this.res.text).to.equal(errorMsg404);
    });
  });

  describe('when the image/tag are not sent in the request', async function () {
     before(async function() {
      this.res = await request(this.frontend).put('/service-image/harmony-service-example');
    });

    after(function() {
      delete this.res;
    });

    it('returns a status 404', async function() {
      expect(this.res.status).to.equal(400);
    });

    it('returns a meaningfule error message', async function() {
      expect(this.res.text).to.equal('\'image\' and \'tag\' are required body parameters');
    });
  });

    
  // describe('when a user is not in the EDL deployerables group', async function() {
  //   before(async function() {
  //     this.res = await request(this.frontend).patch('/service/id');
  //   });

  //   after(function() {
  //     delete this.res;
  //   });

  //   it('returns a status 403', async function() {
  //     expect(this.res.status).to.equal(403);
  //   });

  //   it('returns a meaningfule error message', async function() {
  //     expect(this.res.text).to.equal("User foo is not in the EDL deployerables group");
  //   });
  // });

});
