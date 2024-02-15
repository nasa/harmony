import { expect } from 'chai';
import request from 'supertest';

import hookServersStartStop from './helpers/servers';
import { hookRedirect } from './helpers/hooks';
import { auth } from './helpers/auth';
import { stubEdlRequest, token, unstubEdlRequest } from './helpers/auth';
import StubService from './helpers/stub-service';
import { hookEdlTokenAuthentication, hookEdlTokenAuthenticationError } from './helpers/stub-edl-token';

//
// Tests for the service-image endpoint
//
// Note: this test relies on the EDL fixture that includes users `eve` and `buzz` in the
// deployers group, but not `joe`
//

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
};

const errorMsg404 = 'Service foo does not exist.\nThe existing services and their images are\n' +
  JSON.stringify(serviceImages, null, 2);

const userErrorMsg = 'User joe is not in the service deployers EDL group';

describe('Service image endpoint', async function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('List service images', async function () {
    describe('when a user is not in the EDL service deployers group', async function () {
      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).get('/service-image').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('rejects the user', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal(userErrorMsg);
      });
    });

    describe('when a user is in the EDL service deployers group', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-image').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a map of images', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body).to.eql(serviceImages);
      });
    });
  });

  describe('Get service image', async function () {
    describe('when a user is not in the EDL service deployers group', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image/foo').use(auth({ username: 'joe' }));
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal(userErrorMsg);
        });

      });

      describe('when the service does exist', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image/hoss').use(auth({ username: 'joe' }));
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal(userErrorMsg);
        });

      });
    });

    describe('when a user is in the EDL service deployers group', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).get('/service-image/foo').use(auth({ username: 'buzz' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 404', async function () {
          expect(this.res.status).to.equal(404);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal(errorMsg404);
        });

      });

      describe('when the service does exist', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).get('/service-image/hoss').use(auth({ username: 'buzz' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service image information', async function () {
          expect(this.res.body).to.eql({
            'tag': 'latest',
          });
        });

      });
    });

  });

  describe('Update service image', function () {
    describe('when a user is not in the EDL service deployers group', async function () {

      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).put('/service-image/hoss').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('rejects the user', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal("User joe is not in the service deployers EDL group");
      });
    });

    describe('when the service does not exist', async function () {

      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image/foo').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 404', async function () {
        expect(this.res.status).to.equal(404);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal(errorMsg404);
      });
    });

    describe('when the tag is not sent in the request', async function () {

      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image/harmony-service-example').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 400', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('\'tag\' is a required body parameter');
      });
    });
  });

  describe('when the user is in the deployers group and a tag is sent in the request', async function () {

    before(async function () {
      hookRedirect('buzz');
      this.res = await request(this.frontend).put('/service-image/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
    });

    after(function () {
      delete this.res;
    });

    it('returns a status 201', async function () {
      expect(this.res.status).to.equal(201);
    });

    it('returns the tag we sent', async function () {
      expect(this.res.body).to.eql({'tag': 'foo'});
    });

    describe('when the user checks the tag', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-image/harmony-service-example').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns the updated tag', async function () {
        expect(this.res.body).to.eql({
          'tag': 'foo',
        });
      });
    });
  });
});
