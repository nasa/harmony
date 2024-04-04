import { expect } from 'chai';
import * as sinon from 'sinon';
import request from 'supertest';

import hookServersStartStop from './helpers/servers';
import { hookRedirect } from './helpers/hooks';
import { auth } from './helpers/auth';
import * as serviceImageTags from '../app/frontends/service-image-tags';
import { checkServiceExists, checkTag, getImageTagMap, ecrImageNameToComponents } from '../app/frontends/service-image-tags';
import hookDescribeImage from './helpers/container-registry';
import env from '../app/util/env';
import { stub } from 'sinon';

//
// Tests for the service-image endpoint
//
// Note: this test relies on the EDL fixture that includes users `eve` and `buzz` in the
// deployers group and `adam` in the admin group, and `joe` in neither
//

const serviceImages = {
  'batchee': 'latest',
  'geoloco': 'latest',
  'giovanni-adapter': 'latest',
  'harmony-gdal-adapter': 'latest',
  'harmony-netcdf-to-zarr': 'latest',
  'harmony-regridder': 'latest',
  'harmony-service-example': 'latest',
  'hoss': 'latest',
  'hybig': 'latest',
  'podaac-concise': 'sit',
  'podaac-l2-subsetter': 'sit',
  'query-cmr': 'latest',
  'sds-maskfill': 'latest',
  'stitchee': 'latest',
  'swath-projector': 'latest',
  'trajectory-subsetter': 'latest',
};

const errorMsg404 = 'Service foo does not exist.\nThe existing services and their images are\n' +
  JSON.stringify(serviceImages, null, 2);

const userErrorMsg = 'User joe is not in the service deployers or admin EDL groups';

const tagContentErrorMsg = 'A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.';

//
// Unit tests
//

describe('getImageTagMap', function () {
  let originalEnv: NodeJS.ProcessEnv;

  let envStub;
  beforeEach(function () {
    originalEnv = process.env;
    process.env = {};
    envStub = stub(env, 'locallyDeployedServices').get(() => 'my-service,another-service,missing-tag-service,no-image-env-var');
  });

  afterEach(function () {
    process.env = originalEnv;
    envStub.restore();
  });

  it('should correctly map service names to image tags, excluding Harmony core services', function () {
    // Setup
    process.env.MY_SERVICE_IMAGE = 'repo/my-service:latest';
    process.env.ANOTHER_SERVICE_IMAGE = 'repo/another-service:v1.2.3';
    process.env.MISSING_TAG_IMAGE = 'repo/missing-tag-service';
    process.env.NOT_DEPLOYED_SERVICE_IMAGE = 'repo/not-deployed:latest';

    const result = getImageTagMap();

    expect(result).to.be.an('object');
    expect(result).to.have.property('my-service', 'latest');
    expect(result).to.have.property('another-service', 'v1.2.3');
    expect(result).not.to.have.property('no-image-env-var');
    expect(result).not.to.have.property('missing-tag-service');
    expect(result).not.to.have.property('not-deployed-service');
  });
});

describe('checkServiceExists', function () {
  let originalEnv: NodeJS.ProcessEnv;

  let envStub;
  beforeEach(function () {
    originalEnv = process.env;
    envStub = stub(env, 'locallyDeployedServices').get(() => 'my-service,another-service,missing-tag-service,no-image-env-var');

    process.env = {};
    process.env.MY_SERVICE_IMAGE = 'repo/my-service:latest';
    process.env.ANOTHER_SERVICE_IMAGE = 'repo/another-service:v1.2.3';
    process.env.MISSING_TAG_IMAGE = 'repo/missing-tag-service';
  });

  afterEach(function () {
    process.env = originalEnv;
    envStub.restore();
  });

  it('should return null if the service exists', function () {
    const result = checkServiceExists('my-service');
    expect(result).to.be.null;
  });

  it('should return an error message if the service does not exist', function () {
    const result = checkServiceExists('foo');

    expect(result).to.include('Service foo does not exist.');
    expect(result).to.include('The existing services and their images are');
    expect(result).to.include(JSON.stringify(getImageTagMap(), null, 2));
  });
});

describe('checkTag', function () {
  it('should return null for valid tags', function () {
    // Examples of valid tags
    const validTags = [
      'latest',
      '1.0',
      'v1.0.1',
      'version_1.2.3',
      'a'.repeat(128), // Maximum length
    ];

    validTags.forEach(tag => {
      const result = checkTag(tag);
      expect(result).to.be.null;
    });
  });

  it('should return an error message for invalid tags', function () {
    // Examples of invalid tags
    const invalidTags = [
      '.startwithdot',
      '-startwithdash',
      '!invalidchar',
      'a'.repeat(129), // Exceeds maximum length
    ];

    const errorMessage = 'A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.';

    invalidTags.forEach(tag => {
      const result = checkTag(tag);
      expect(result).to.equal(errorMessage);
    });
  });
});

describe('ecrImageNameToComponents', function () {
  it('should correctly break down a valid ECR image name into its components', function () {
    // Example of a valid ECR image name
    const imageName = '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmony/my-repository:my-tag';

    const expectedComponents = {
      registryId: '123456789012',
      host: '123456789012.dkr.ecr.us-west-2.amazonaws.com',
      region: 'us-west-2',
      repository: 'harmony/my-repository',
      tag: 'my-tag',
    };

    const components = ecrImageNameToComponents(imageName);

    expect(components).to.deep.equal(expectedComponents);
  });

  it('should return null for an invalid ECR image name', function () {
    // Example of an invalid ECR image name
    const invalidImageName = 'invalid-image-name';

    const components = ecrImageNameToComponents(invalidImageName);

    expect(components).to.be.null;
  });
});

//
// Integration tests
//

describe('Service image endpoint', async function () {
  let envStub;
  beforeEach(function () {
    envStub = stub(env, 'locallyDeployedServices').get(() => 'giovanni-adapter,harmony-service-example,harmony-netcdf-to-zarr,var-subsetter,swath-projector,harmony-gdal-adapter,podaac-concise,sds-maskfill,trajectory-subsetter,podaac-l2-subsetter,harmony-regridder,hybig,geoloco');
  });

  afterEach(function () {
    envStub.restore();
  });

  const locallyDeployedServices = 'giovanni-adapter,harmony-service-example,harmony-netcdf-to-zarr,var-subsetter,swath-projector,harmony-gdal-adapter,podaac-concise,sds-maskfill,trajectory-subsetter,podaac-l2-subsetter,harmony-regridder,hybig,geoloco';

  beforeEach(function () {
    process.env.LOCALLY_DEPLOYED_SERVICES = locallyDeployedServices;
  });

  hookServersStartStop({ skipEarthdataLogin: false });

  describe('List service images', async function () {
    describe('when a user is not in the EDL service deployers or admin groups', async function () {
      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'joe' }));
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
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a map of images in alphabetical order', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body).to.eql(serviceImages);
      });
    });

    describe('when a user is in the EDL admin group', async function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'adam' }));
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
    describe('when a user is not in the EDL service deployers or admin groups', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'joe' }));
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
          this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'joe' }));
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
          this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'buzz' }));
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
          this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'buzz' }));
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

    describe('when a user is in the EDL admin group', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('adam');
          this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'adam' }));
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
          hookRedirect('adam');
          this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'adam' }));
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
    let execDeployScriptStub: sinon.SinonStub;
    before(async function () {
      execDeployScriptStub = sinon.stub(serviceImageTags, 'execDeployScript').callsFake(() => null);
    });

    after(function () {
      execDeployScriptStub.restore();
    });

    describe('when a user is not in the EDL service deployers or admin groups', async function () {

      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).put('/service-image-tag/hoss').use(auth({ username: 'joe' }));
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

    describe('when the service does not exist', async function () {

      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image-tag/foo').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
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
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' }));
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

    describe('when the user is in the deployers group, but the tag has invalid characters', async function () {

      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo:bar' });
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 400', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal(tagContentErrorMsg);
      });
    });

    describe('when the user is in the deployers group, but the image is not reachable', async function () {
      let originalEnv;
      before(async function () {
        hookRedirect('buzz');
        // Save the original process.env
        originalEnv = process.env;

        // Setup
        process.env.HOSS_IMAGE = '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmony/my-repository:my-tag';
        process.env.HARMONY_SERVICE_EXAMPLE_IMAGE = 'ghcr.io/nasa/my-repository:my-tag';
      });

      after(function () {
        // Restore the original process.env after each test
        process.env = originalEnv;
      });

      describe('when the image is an ECR image', async function () {
        hookDescribeImage(null);

        before(async function () {
          this.res = await request(this.frontend).put('/service-image-tag/hoss').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 404', async function () {
          expect(this.res.status).to.equal(404);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('123456789012.dkr.ecr.us-west-2.amazonaws.com/harmony/my-repository:foo is unreachable');
        });
      });

      describe('when the image is not an ECR image', async function () {
        let execStub;
        hookDescribeImage(null);

        before(async function () {
          // resolve to non-zero exit code meaning script failed
          execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({ err: { code: 1 } }));
          this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
        });

        after(function () {
          execStub.restore();
          delete this.res;
        });

        it('returns a status 404', async function () {
          expect(this.res.status).to.equal(404);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('ghcr.io/nasa/my-repository:foo is unreachable');
        });
      });
    });

    describe('when the user is in the deployers group and a valid tag is sent in the request', async function () {
      let execStub;
      hookDescribeImage({
        imageDigest: '',
        lastUpdated: undefined,
      });
      before(async function () {
        // resolve without error meaning script executed OK
        execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });

      });

      after(function () {
        execStub.restore();
        delete this.res;
      });

      it('returns a status 202', async function () {
        expect(this.res.status).to.equal(202);
      });

      it('returns the tag we sent', async function () {
        expect(this.res.body).to.eql({ 'tag': 'foo' });
      });
    });

    describe('when the user is in the admin group and a valid tag is sent in the request', async function () {
      let execStub;
      hookDescribeImage({
        imageDigest: '',
        lastUpdated: undefined,
      });
      before(async function () {
        // resolve to zero exit code meaning script executed OK
        execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve(0));
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'adam' })).send({ tag: 'foo' });
      });

      after(function () {
        execStub.restore();
        delete this.res;
      });

      it('returns a status 202', async function () {
        expect(this.res.status).to.equal(202);
      });

      it('returns the tag we sent', async function () {
        expect(this.res.body).to.eql({ 'tag': 'foo' });
      });
    });
  });

  describe('Enable and disable service image tag update', async function () {
    describe('when a user is a regular user, not in the EDL service admin groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image-tag/state').use(auth({ username: 'joe' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service image information', async function () {
          expect(this.res.body).to.eql({
            'enabled': true,
          });
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'joe' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User joe is not in the admin EDL group');
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'joe' })).send({ enabled: false });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User joe is not in the admin EDL group');
        });
      });

    });

    describe('when a user is in deployers group, not in the EDL service admin groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).get('/service-image-tag/state').use(auth({ username: 'buzz' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service image information', async function () {
          expect(this.res.body).to.eql({
            'enabled': true,
          });
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'buzz' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User buzz is not in the admin EDL group');
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'buzz' })).send({ enabled: false });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the user', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User buzz is not in the admin EDL group');
        });
      });

    });

    describe('when a user is in the EDL service admin groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('adam');
          this.res = await request(this.frontend).get('/service-image-tag/state').use(auth({ username: 'adam' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service image information', async function () {
          expect(this.res.body).to.eql({
            'enabled': true,
          });
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('adam');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'adam' })).send({ enabled: false });
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns enabled false', async function () {
          expect(this.res.body).to.eql({
            'enabled': false,
          });
        });

        describe('when trying to deploy service when service deployment is disabled', async function () {
          let execStub;
          hookDescribeImage({
            imageDigest: '',
            lastUpdated: undefined,
          });
          before(async function () {
            execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));
            this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'adam' })).send({ tag: 'foo' });
          });

          after(function () {
            execStub.restore();
            delete this.res;
          });

          it('returns a status 503', async function () {
            expect(this.res.status).to.equal(503);
          });

          it('returns service deployment is disbabled error message', async function () {
            expect(this.res.text).to.eql('Service deployment is disabled.');
          });
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('adam');
          this.res = await request(this.frontend).put('/service-image-tag/state').use(auth({ username: 'adam' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns enabled true', async function () {
          expect(this.res.body).to.eql({
            'enabled': true,
          });
        });

        describe('when deploy service when service deployment is enabled', async function () {
          let execStub;
          hookDescribeImage({
            imageDigest: '',
            lastUpdated: undefined,
          });
          before(async function () {
            execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));
            this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'adam' })).send({ tag: 'foo' });
          });

          after(function () {
            execStub.restore();
            delete this.res;
          });

          it('returns a status 202', async function () {
            expect(this.res.status).to.equal(202);
          });

          it('returns the tag we sent', async function () {
            expect(this.res.body).to.eql({ 'tag': 'foo' });
          });
        });
      });
    });

  });
});
