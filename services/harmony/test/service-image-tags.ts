import * as k8s from '@kubernetes/client-node';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { stub } from 'sinon';
import request from 'supertest';
import { v4 as uuid } from 'uuid';

import { auth } from './helpers/auth';
import hookDescribeImage from './helpers/container-registry';
import { hookRedirect } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';
import * as serviceImageTags from '../app/frontends/service-image-tags';
import { checkServiceExists, checkTag, getImageTagMap, ecrImageNameToComponents, enableServiceDeployment } from '../app/frontends/service-image-tags';
import HarmonyRequest from '../app/models/harmony-request';
import ServiceDeployment, { getDeploymentById } from '../app/models/service-deployment';
import db from '../app/util/db';
import env from '../app/util/env';
import { objectStoreForProtocol } from '../app/util/object-store';

//
// Tests for the service-image endpoint
//
// Note: this test relies on the EDL fixture that includes users `eve` and `buzz` in the
// deployers group and `coraline` in the core permissions group, and `joe` in neither
//

const serviceImages = {
  'batchee': 'latest',
  'geoloco': 'latest',
  'giovanni-time-series-adapter': '1.0.0',
  'harmony-gdal-adapter': 'latest',
  'harmony-regridder': 'latest',
  'harmony-service-example': 'latest',
  'hoss': 'latest',
  'hybig': 'latest',
  'maskfill': 'latest',
  'podaac-concise': 'sit',
  'podaac-l2-subsetter': 'sit',
  'query-cmr': 'stable',
  'stitchee': 'latest',
  'subset-band-name': 'latest',
  'swath-projector': 'latest',
  'trajectory-subsetter': 'latest',
};

const errorMsg404 = 'Service foo does not exist.\nThe existing services and their images are\n' +
  JSON.stringify(serviceImages, null, 2);

const userErrorMsg = 'User joe does not have permission to access this resource';

const tagContentErrorMsg = 'A tag name may contain lowercase and uppercase characters, digits, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.';

/**
 * Get deployment id from the given status link
 *
 * @param statusLink - the status link
 * Returns deploymentId - the deployment id
 */
function getDeploymentIdFromStatusLink(statusLink: string): String {
  const uuidRegex = /service-deployment\/([a-fA-F0-9-]+)$/;
  const match = statusLink.match(uuidRegex);
  return match ? match[1] : null;
}

/**
 * Wait until deployment status is not running or time expires
 *
 * @param deploymentId - the deployment id
 * Returns true if status changed from running, or false if timed out
 */
async function waitUntilStatusChange(deploymentId: string): Promise<boolean | null> {
  let deploymentStatus = 'running';
  const intervalMs = 100;
  const timeoutMs = 5000;
  return new Promise<boolean | null>((resolve) => {
    let elapsedTime = 0;
    const interval = setInterval(async () => {
      await db.transaction(async (tx) => {
        const { status } = await getDeploymentById(tx, deploymentId);
        deploymentStatus = status;
      });

      if (deploymentStatus !== 'running') {
        clearInterval(interval);
        resolve(true);
      } else if (elapsedTime >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }

      elapsedTime += intervalMs;
    }, intervalMs);
  });
}

/**
 * Insert a running service deployment record directly, for tests that call
 * `runDeployJob` without going through the `/service-image-tag` endpoint.
 *
 * @param deploymentId - the deployment id
 * @param service - the canonical service name
 * @param tag - the image tag
 */
async function createRunningDeployment(
  deploymentId: string, service = 'harmony-service-example', tag = 'foo',
): Promise<void> {
  const deployment = new ServiceDeployment({
    deployment_id: deploymentId,
    username: 'buzz',
    service,
    tag,
    regression_test_version: 'latest',
    status: 'running',
    message: 'Deployment in progress',
  });
  await db.transaction(async (tx) => {
    await deployment.save(tx);
  });
}

/**
 * Build a minimal fake request object sufficient for `runDeployJob`/`handleDeployScriptResult`,
 * which only use `req.get('host')` (via `getRequestRoot`) and `req.context.logger`.
 */
function fakeDeployRequest(): HarmonyRequest {
  return {
    get: (name: string): string => (name === 'host' ? '127.0.0.1:4000' : undefined),
    context: { logger: { info: () => {}, error: () => {} } },
  } as unknown as HarmonyRequest;
}

/**
 * Build a fake pair of Kubernetes API clients for stubbing `getK8sClients`.
 */
function fakeK8sClients(overrides: {
  createNamespacedJob?: sinon.SinonStub,
  readNamespacedJob?: sinon.SinonStub,
  listNamespacedPod?: sinon.SinonStub,
  readNamespacedPodLog?: sinon.SinonStub,
} = {}): { batchApi: k8s.BatchV1Api, coreApi: k8s.CoreV1Api } {
  return {
    batchApi: {
      createNamespacedJob: overrides.createNamespacedJob || sinon.stub().resolves({}),
      readNamespacedJob: overrides.readNamespacedJob || sinon.stub().resolves({ status: { succeeded: 1 } }),
    },
    coreApi: {
      listNamespacedPod: overrides.listNamespacedPod ||
        sinon.stub().resolves({ items: [{ metadata: { name: 'deploy-pod-1' } }] }),
      readNamespacedPodLog: overrides.readNamespacedPodLog || sinon.stub().resolves(''),
    },
  } as unknown as { batchApi: k8s.BatchV1Api, coreApi: k8s.CoreV1Api };
}

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
      'version-1.2.3',
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
      'version_1.2.3',
      'a'.repeat(129), // Exceeds maximum length
    ];

    invalidTags.forEach(tag => {
      const result = checkTag(tag);
      expect(result).to.equal(tagContentErrorMsg);
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

describe('buildDeployerJobManifest', function () {
  let envCicdStub;

  beforeEach(function () {
    envCicdStub = stub(env, 'cicdDeployerImage').get(
      () => '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/harmony-ci-cd-deployer:latest');
  });

  afterEach(function () {
    envCicdStub.restore();
  });

  it('builds a Job manifest with the expected shape', function () {
    const deploymentId = '12345678-abcd-ef01-2345-6789abcdef01';
    const job = serviceImageTags.buildDeployerJobManifest(
      'harmony-service-example', 'foo', '1.2.3', deploymentId);

    expect(job.metadata.name).to.equal(`deploy-harmony-service-example-${deploymentId.slice(0, 8)}`);
    expect(job.metadata.namespace).to.equal('harmony');
    expect(job.spec.backoffLimit).to.equal(0);
    expect(job.spec.ttlSecondsAfterFinished).to.equal(60);

    const podSpec = job.spec.template.spec;
    expect(podSpec.restartPolicy).to.equal('Never');
    expect(podSpec.serviceAccountName).to.equal('harmony-deployer');

    const container = podSpec.containers[0];
    expect(container.image).to.equal(
      '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/harmony-ci-cd-deployer:latest');
    expect(container.args).to.eql(['harmony-service-example', 'foo', '1.2.3']);
    expect(container.envFrom).to.eql([
      { configMapRef: { name: 'harmony-env' } },
      { configMapRef: { name: 'queue-urls-env' } },
      { secretRef: { name: 'harmony-secrets' } },
    ]);
  });
});

//
// Integration tests
//

describe('Service image endpoint', async function () {
  let envStub;
  beforeEach(function () {
    envStub = stub(env, 'locallyDeployedServices').get(() => 'harmony-service-example,var-subsetter,swath-projector,harmony-gdal-adapter,podaac-concise,maskfill,trajectory-subsetter,podaac-l2-subsetter,harmony-regridder,hybig,geoloco');
  });

  afterEach(function () {
    envStub.restore();
  });

  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('List service images', async function () {
    describe('when a user is not in the EDL service deployers or core permissions groups', async function () {
      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a map of images in alphabetical order', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body).to.eql(serviceImages);
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

    describe('when a user is in the EDL core permissions group', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'coraline' }));
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
    describe('when a user is not in the EDL service deployers or core permissions groups', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'joe' }));
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
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-image-tag/trajectory-subsetter').use(auth({ username: 'joe' }));
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
          this.res = await request(this.frontend).get('/service-image-tag/trajectory-subsetter').use(auth({ username: 'buzz' }));
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

    describe('when a user is in the EDL core permissions group', async function () {

      describe('when the service does not exist', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'coraline' }));
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
          hookRedirect('coraline');
          this.res = await request(this.frontend).get('/service-image-tag/trajectory-subsetter').use(auth({ username: 'coraline' }));
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

    describe('when a user is not in the EDL service deployers or core permissions groups', async function () {

      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).put('/service-image-tag/hoss').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('rejects the request as forbidden', async function () {
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

    describe('when invalid fields are provided in the request', async function () {

      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image-tag/hoss').use(auth({ username: 'buzz' })).send(
          { tag: 'latest', unsupportedOne: 'foo', unsupportedTwo: 'foo' });
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 400', async function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('Invalid body parameter(s): unsupportedOne and unsupportedTwo. Allowed body parameters are: tag and regression_test_version.');
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
      let link = null;
      let deploymentId = null;
      hookDescribeImage({
        imageDigest: '',
        lastUpdated: undefined,
      });

      before(async function () {
        execDeployScriptStub.restore();
        // resolve without error meaning script executed OK
        execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

        // Stub out the exec function to simulate successful execution
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
        execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

        hookRedirect('buzz');
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
      });

      after(function () {
        execStub.restore();
        execDeployScriptStub.restore();
        delete this.res;
      });

      it('returns a status 202', async function () {
        expect(this.res.status).to.equal(202);
      });

      it('returns the tag we sent', async function () {
        expect(this.res.body.tag).to.eql('foo');
      });

      it('returns statusLink', async function () {
        link = this.res.body.statusLink;
        expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
        deploymentId = getDeploymentIdFromStatusLink(link);
        expect(deploymentId).to.not.be.null;
      });

      it('reaches a terminal status without timeout', async function () {
        const noTimeout = await waitUntilStatusChange(deploymentId);
        expect(noTimeout).to.be.true;
      });

      describe('when get the service image tag update state after a successful service deployment', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'buzz' }));
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
            'message': `Re-enable service deployment after successful deployment: ${deploymentId}`,
          });
        });
      });
    });

    describe('when the user is in the core permissions group and a valid tag is sent in the request', async function () {
      let execStub;
      let link = null;
      let deploymentId = null;

      hookDescribeImage({
        imageDigest: '',
        lastUpdated: undefined,
      });

      before(async function () {
        execDeployScriptStub.restore();
        // resolve without error meaning script executed OK
        execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

        // Stub out the exec function to simulate successful execution
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
        execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

        hookRedirect('coraline');
        this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'coraline' })).send({ tag: 'foo' });
      });

      after(function () {
        execStub.restore();
        execDeployScriptStub.restore();
        delete this.res;
      });

      it('returns a status 202', async function () {
        expect(this.res.status).to.equal(202);
      });

      it('returns the tag we sent', async function () {
        expect(this.res.body.tag).to.eql('foo');
      });

      it('returns statusLink', async function () {
        link = this.res.body.statusLink;
        expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
        deploymentId = getDeploymentIdFromStatusLink(link);
        expect(deploymentId).to.not.be.null;
      });

      it('reaches a terminal status without timeout', async function () {
        const noTimeout = await waitUntilStatusChange(deploymentId);
        expect(noTimeout).to.be.true;
      });

      describe('when get the service image tag update state after a successful service deployment', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'coraline' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service image enabled true', async function () {
          expect(this.res.body.enabled).to.eql(true);
        });
      });
    });
  });

  describe('Get service deployment enabled state permission test', async function () {
    describe('when a user is not in the EDL service deployers or core permissions groups', async function () {
      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('rejects the request', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal(userErrorMsg);
      });
    });

    describe('when a user is in the EDL service deployers group', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns the expected result', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body.enabled).to.eql(true);
      });
    });

    describe('when a user is in the EDL core permissions group', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'coraline' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns the expected result', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body.enabled).to.eql(true);
      });
    });
  });

  describe('Enable and disable service image tag update', async function () {
    describe('when validate enabled request body', async function () {
      describe('when enable/disable the service image tag update with empty body', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'coraline' })).send('');
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(400);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('\'enabled\' is a required body parameter');
        });
      });

      describe('when enable/disable the service image tag update with invalid value', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'coraline' })).send({ enabled: 'enabled' });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(400);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('\'enabled\' can only take value of true or false');
        });
      });
    });

    describe('when a user is a regular user, not in the EDL service deployers or core permissions groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'joe' }));
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User joe does not have permission to access this resource');
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'joe' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User joe does not have permission to access this resource');
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('joe');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'joe' })).send({ enabled: false });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User joe does not have permission to access this resource');
        });
      });

    });

    describe('when a user is in service deployers group, not in the EDL core permissions groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'buzz' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns enabled true', async function () {
          expect(this.res.body.enabled).to.eql(true);
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'buzz' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User buzz does not have permission to access this resource');
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('buzz');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'buzz' })).send({ enabled: false });
        });

        after(function () {
          delete this.res;
        });

        it('rejects the request', async function () {
          expect(this.res.status).to.equal(403);
        });

        it('returns a meaningful error message', async function () {
          expect(this.res.text).to.equal('User buzz does not have permission to access this resource');
        });
      });

    });

    describe('when a user is in the EDL core permissions groups', async function () {

      describe('when get the service image tag update state', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'coraline' }));
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns the service enabled true', async function () {
          expect(this.res.body.enabled).to.eql(true);
        });
      });

      describe('when disable the service image tag update', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'coraline' })).send({ enabled: false });
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
            'message': 'Manually disabled by coraline',
          });
        });

        describe('when trying to deploy service when service deployment is disabled', async function () {
          hookDescribeImage({
            imageDigest: '',
            lastUpdated: undefined,
          });
          before(async function () {
            this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'coraline' })).send({ tag: 'foo' });
          });

          after(function () {
            delete this.res;
          });

          it('returns a status 423', async function () {
            expect(this.res.status).to.equal(423);
          });

          it('returns service deployment is disbabled error message', async function () {
            expect(this.res.text).to.eql('Service deployment is disabled. Reason: Manually disabled by coraline.');
          });
        });

        describe('when trying to disable the service image tag update when it is already disabled', async function () {
          before(async function () {
            hookRedirect('coraline');
            this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'coraline' })).send({ enabled: false });
          });

          after(function () {
            delete this.res;
          });

          it('returns a status 423', async function () {
            expect(this.res.status).to.equal(423);
          });

          it('returns the proper error message', async function () {
            expect(this.res.text).to.eql('Unable to acquire service deployment lock. Reason: Manually disabled by coraline. Try again later.');
          });
        });
      });

      describe('when enable the service image tag update', async function () {
        before(async function () {
          hookRedirect('coraline');
          this.res = await request(this.frontend).put('/service-deployments-state').use(auth({ username: 'coraline' })).send({ enabled: true });
        });

        after(function () {
          delete this.res;
        });

        it('returns a status 200', async function () {
          expect(this.res.status).to.equal(200);
        });

        it('returns enabled true', async function () {
          expect(this.res.body.enabled).to.eql(true);
        });

        describe('when deploy service when service deployment is enabled', async function () {
          let execStub;
          let execDeployScriptStub: sinon.SinonStub;
          let linkDeploymentId = null;
          let statusPath = null;

          hookDescribeImage({
            imageDigest: '',
            lastUpdated: undefined,
          });

          before(async function () {
            // resolve without error meaning script executed OK
            execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

            // Stub out the exec function to simulate successful execution
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
            execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

            hookRedirect('coraline');
            this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'coraline' })).send({ tag: 'foo' });
          });

          after(function () {
            execStub.restore();
            execDeployScriptStub.restore();
            delete this.res;
          });

          it('returns a status 202', async function () {
            expect(this.res.status).to.equal(202);
          });

          it('returns the tag we sent', async function () {
            expect(this.res.body.tag).to.eql('foo');
          });

          it('returns statusLink', async function () {
            const link = this.res.body.statusLink;
            statusPath = new URL(link).pathname;
            expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
            linkDeploymentId = getDeploymentIdFromStatusLink(link);
            expect(linkDeploymentId).to.not.be.null;
          });

          it('reaches a terminal status without timeout', async function () {
            const noTimeout = await waitUntilStatusChange(linkDeploymentId);
            expect(noTimeout).to.be.true;
          });

          describe('Get service deployment status permission test', async function () {
            describe('when a user is not in the EDL service deployers or core permissions groups', async function () {
              before(async function () {
                hookRedirect('joe');
                this.res = await request(this.frontend).get(statusPath).use(auth({ username: 'joe' }));
              });

              after(function () {
                delete this.res;
              });

              it('rejects the request', async function () {
                expect(this.res.status).to.equal(403);
              });

              it('returns a meaningful error message', async function () {
                expect(this.res.text).to.equal(userErrorMsg);
              });
            });

            describe('when a user is in the EDL service deployers group', async function () {
              before(async function () {
                hookRedirect('buzz');
                this.res = await request(this.frontend).get(statusPath).use(auth({ username: 'buzz' }));
              });

              after(function () {
                delete this.res;
              });

              it('returns status code 200', async function () {
                expect(this.res.status).to.equal(200);
              });

              it('returns the deployment status successful', async function () {
                const { deploymentId, username, service, tag, status, message } = this.res.body;
                expect(deploymentId).to.eql(linkDeploymentId);
                expect(username).to.eql('coraline');
                expect(service).to.eql('harmony-service-example');
                expect(tag).to.eql('foo');
                expect(status).to.eql('successful');
                expect(message).to.include('Deployment successful');
              });
            });

            describe('when a user is in the EDL core permissions group', async function () {
              before(async function () {
                hookRedirect('coraline');
                this.res = await request(this.frontend).get(statusPath).use(auth({ username: 'coraline' }));
              });

              after(function () {
                delete this.res;
              });

              it('returns status code 200', async function () {
                expect(this.res.status).to.equal(200);
              });

              it('returns the deployment status successful', async function () {
                const { deploymentId, username, service, tag, status, message } = this.res.body;
                expect(deploymentId).to.eql(linkDeploymentId);
                expect(username).to.eql('coraline');
                expect(service).to.eql('harmony-service-example');
                expect(tag).to.eql('foo');
                expect(status).to.eql('successful');
                expect(message).to.include('Deployment successful');
              });
            });
          });
        });
      });
    });
  });
});

describe('Service self-deployment successful', async function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('Update service image successful', function () {
    let execStub;
    let execDeployScriptStub: sinon.SinonStub;
    let link = null;
    let linkDeploymentId = null;
    let deploymentLogPath = null;

    hookDescribeImage({
      imageDigest: '',
      lastUpdated: undefined,
    });

    before(async function () {
      // resolve without error meaning script executed OK
      execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

      // Stub out the exec function to simulate successful execution
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
      execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

      hookRedirect('buzz');
      this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
    });

    after(function () {
      execStub.restore();
      execDeployScriptStub.restore();
      delete this.res;
    });

    it('returns a status 202', async function () {
      expect(this.res.status).to.equal(202);
    });

    it('returns the tag we sent', async function () {
      expect(this.res.body.tag).to.eql('foo');
    });

    it('returns statusLink', async function () {
      link = this.res.body.statusLink;
      expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
      linkDeploymentId = getDeploymentIdFromStatusLink(link);
      expect(linkDeploymentId).to.not.be.null;
    });

    it('reaches a terminal status without timeout', async function () {
      const noTimeout = await waitUntilStatusChange(linkDeploymentId);
      expect(noTimeout).to.be.true;
    });

    describe('when get the status of successful deployment', async function () {
      before(async function () {
        hookRedirect('buzz');
        const { pathname } = new URL(link);
        this.res = await request(this.frontend).get(pathname).use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the deployment status successful', async function () {
        const { deploymentId, username, service, tag, regressionTestVersion, status, message } = this.res.body;
        deploymentLogPath = `/deployment-logs/${deploymentId}`;
        expect(deploymentId).to.eql(linkDeploymentId);
        expect(username).to.eql('buzz');
        expect(service).to.eql('harmony-service-example');
        expect(tag).to.eql('foo');
        // regressionTestVersion is set to the default value
        expect(regressionTestVersion).to.eql('latest');
        expect(status).to.eql('successful');
        expect(message).to.include('Deployment successful');
        expect(message).to.include(`See details at: http://127.0.0.1:4000${deploymentLogPath}`);
      });
    });

    describe('when get the service deployment log with authorized user', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get(deploymentLogPath).use(auth({ username: 'coraline' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns enabled false', async function () {
        expect(this.res.body).to.eql(['Success output']);
      });
    });

    describe('when get the service deployment log with unprivileged user', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get(deploymentLogPath).use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 403', async function () {
        expect(this.res.status).to.equal(403);
      });
      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('User joe does not have permission to access this resource');
      });
    });

    describe('when get the service image tag update state after a successful service deployment', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns enabled true', async function () {
        expect(this.res.body.enabled).to.eql(true);
      });
    });

    describe('when get the status with a nonexist deployment id', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-deployment/5a36085d-b40e-4296-96da-e406d7751166').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 404', async function () {
        expect(this.res.status).to.equal(404);
      });

      it('returns the deployment status successful', async function () {
        expect(this.res.body).to.eql({ 'error': 'Deployment does not exist' });
      });
    });
  });
});

describe('Service self-deployment failure', async function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('Update service image failed', function () {
    let execStub;
    let execDeployScriptStub: sinon.SinonStub;
    let link = null;
    let linkDeploymentId = null;
    let deploymentLogPath = null;
    const errorMessage = 'Script execution failed';

    hookDescribeImage({
      imageDigest: '',
      lastUpdated: undefined,
    });

    before(async function () {
      // resolve without error meaning script executed OK
      execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

      // Stub out the exec function to simulate failed execution
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
      execDeployScriptStub.callsArgWith(2, new Error(errorMessage), 'Failure output', '');

      hookRedirect('coraline');
      this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'coraline' })).send(
        { tag: 'foo', regression_test_version: '1.2.3' });
    });

    after(async function () {
      execStub.restore();
      execDeployScriptStub.restore();
      await enableServiceDeployment('');
      delete this.res;
    });

    it('returns a status 202', async function () {
      expect(this.res.status).to.equal(202);
    });

    it('returns the tag we sent', async function () {
      expect(this.res.body.tag).to.eql('foo');
    });

    it('returns statusLink', async function () {
      link = this.res.body.statusLink;
      expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
      linkDeploymentId = getDeploymentIdFromStatusLink(link);
      expect(linkDeploymentId).to.not.be.null;
    });

    it('reaches a terminal status without timeout', async function () {
      const noTimeout = await waitUntilStatusChange(linkDeploymentId);
      expect(noTimeout).to.be.true;
    });

    describe('when get the status of failed deployment', async function () {
      before(async function () {
        hookRedirect('coraline');
        const { pathname } = new URL(link);
        this.res = await request(this.frontend).get(pathname).use(auth({ username: 'coraline' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the deployment status failed and the proper error message', async function () {
        const { deploymentId, username, service, tag, regressionTestVersion, status, message } = this.res.body;
        deploymentLogPath = `/deployment-logs/${deploymentId}`;
        expect(deploymentId).to.eql(linkDeploymentId);
        expect(username).to.eql('coraline');
        expect(service).to.eql('harmony-service-example');
        expect(tag).to.eql('foo');
        // regressionTestVersion matches the specified value of the 'regression_test_version' field in the request body
        expect(regressionTestVersion).to.eql('1.2.3');
        expect(status).to.eql('failed');
        expect(message).to.include(`Failed service deployment for deploymentId: ${deploymentId}.`);
        expect(message).to.include(`See details at: http://127.0.0.1:4000${deploymentLogPath}`);
      });
    });

    describe('when get the service deployment log with authorized user', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get(deploymentLogPath).use(auth({ username: 'coraline' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns enabled false', async function () {
        expect(this.res.body).to.eql(['Failure output']);
      });
    });

    describe('when get the service deployment log with unprivileged user', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get(deploymentLogPath).use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 403', async function () {
        expect(this.res.status).to.equal(403);
      });
      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('User joe does not have permission to access this resource');
      });
    });

    describe('when get the service image tag update state after a failed service deployment', async function () {
      before(async function () {
        hookRedirect('coraline');
        this.res = await request(this.frontend).get('/service-deployments-state').use(auth({ username: 'coraline' }));
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
          'message': `Locked for service deployment: http://127.0.0.1:4000/service-deployment/${linkDeploymentId}`,
        });
      });
    });
  });
});

describe('execDeployScript dispatcher', async function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('when cicdDeployerImage is not set (EC2 path)', function () {
    let envCicdStub;
    let runDeployJobStub: sinon.SinonStub;
    let execStub;
    let execDeployScriptStub: sinon.SinonStub;
    let linkDeploymentId = null;

    hookDescribeImage({
      imageDigest: '',
      lastUpdated: undefined,
    });

    before(async function () {
      envCicdStub = stub(env, 'cicdDeployerImage').get(() => undefined);
      runDeployJobStub = sinon.stub(serviceImageTags, 'runDeployJob');
      execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
      execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

      hookRedirect('buzz');
      this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
    });

    after(function () {
      envCicdStub.restore();
      runDeployJobStub.restore();
      execStub.restore();
      execDeployScriptStub.restore();
      delete this.res;
    });

    it('returns a status 202', async function () {
      expect(this.res.status).to.equal(202);
    });

    it('returns statusLink', async function () {
      const link = this.res.body.statusLink;
      linkDeploymentId = getDeploymentIdFromStatusLink(link);
      expect(linkDeploymentId).to.not.be.null;
    });

    it('reaches a terminal status without timeout', async function () {
      const noTimeout = await waitUntilStatusChange(linkDeploymentId);
      expect(noTimeout).to.be.true;
    });

    it('runs the legacy exec path and never calls runDeployJob', function () {
      expect(runDeployJobStub.called).to.be.false;
      expect(execDeployScriptStub.called).to.be.true;
    });
  });
});

describe('runDeployJob', function () {
  let envCicdStub;
  let getK8sClientsStub: sinon.SinonStub;

  beforeEach(function () {
    envCicdStub = stub(env, 'cicdDeployerImage').get(
      () => '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/harmony-ci-cd-deployer:latest');
  });

  afterEach(async function () {
    envCicdStub.restore();
    if (getK8sClientsStub) {
      getK8sClientsStub.restore();
      getK8sClientsStub = undefined;
    }
    // reset the global deployment-enabled flag in case a test left it disabled
    await enableServiceDeployment('');
  });

  describe('when the Job succeeds', function () {
    let deploymentId: string;
    let createNamespacedJobStub: sinon.SinonStub;
    let readNamespacedJobStub: sinon.SinonStub;
    let readNamespacedPodLogStub: sinon.SinonStub;

    beforeEach(async function () {
      deploymentId = uuid();
      await createRunningDeployment(deploymentId);

      createNamespacedJobStub = sinon.stub().resolves({});
      readNamespacedJobStub = sinon.stub().resolves({ status: { succeeded: 1 } });
      readNamespacedPodLogStub = sinon.stub().resolves('Deployed successfully');

      getK8sClientsStub = sinon.stub(serviceImageTags, 'getK8sClients').returns(fakeK8sClients({
        createNamespacedJob: createNamespacedJobStub,
        readNamespacedJob: readNamespacedJobStub,
        readNamespacedPodLog: readNamespacedPodLogStub,
      }));

      await serviceImageTags.runDeployJob(
        fakeDeployRequest(), 'harmony-service-example', 'foo', deploymentId, 'latest');
    });

    it('creates the Job via the Kubernetes batch API in the harmony namespace', function () {
      expect(createNamespacedJobStub.called).to.be.true;
      const { namespace, body } = createNamespacedJobStub.getCall(0).args[0];
      expect(namespace).to.equal('harmony');
      expect(body.spec.template.spec.containers[0].image).to.equal(
        '123456789012.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/harmony-ci-cd-deployer:latest');
    });

    it('reads the Job pod log', function () {
      expect(readNamespacedPodLogStub.calledWith({ name: 'deploy-pod-1', namespace: 'harmony' })).to.be.true;
    });

    it('marks the deployment successful', async function () {
      let deployment;
      await db.transaction(async (tx) => {
        deployment = await getDeploymentById(tx, deploymentId);
      });
      expect(deployment.status).to.equal('successful');
      expect(deployment.message).to.include('Deployment successful');
    });

    it('re-enables service deployment', async function () {
      await db.transaction(async (tx) => {
        const [row] = await tx('service_deployment').select('enabled');
        expect(row.enabled === true || row.enabled === 1).to.be.true;
      });
    });
  });

  describe('when the Job fails', function () {
    let deploymentId: string;
    let readNamespacedPodLogStub: sinon.SinonStub;

    beforeEach(async function () {
      deploymentId = uuid();
      await createRunningDeployment(deploymentId);
      // simulate the deployment lock already being acquired, as `updateServiceImageTag`
      // does before invoking the deploy script/job
      await db.transaction(async (tx) => {
        await tx('service_deployment').update({ enabled: false, message: `Locked for service deployment: ${deploymentId}` });
      });

      readNamespacedPodLogStub = sinon.stub().resolves('Deployment failed output');
      getK8sClientsStub = sinon.stub(serviceImageTags, 'getK8sClients').returns(fakeK8sClients({
        readNamespacedJob: sinon.stub().resolves({ status: { failed: 1 } }),
        readNamespacedPodLog: readNamespacedPodLogStub,
      }));

      await serviceImageTags.runDeployJob(
        fakeDeployRequest(), 'harmony-service-example', 'foo', deploymentId, 'latest');
    });

    it('marks the deployment failed', async function () {
      let deployment;
      await db.transaction(async (tx) => {
        deployment = await getDeploymentById(tx, deploymentId);
      });
      expect(deployment.status).to.equal('failed');
      expect(deployment.message).to.include(`Failed service deployment for deploymentId: ${deploymentId}`);
    });

    it('does not re-enable service deployment', async function () {
      await db.transaction(async (tx) => {
        const [row] = await tx('service_deployment').select('enabled');
        expect(row.enabled === false || row.enabled === 0).to.be.true;
      });
    });
  });

  describe('when creating the Job fails (e.g. RBAC denial)', function () {
    let deploymentId: string;

    beforeEach(async function () {
      deploymentId = uuid();
      await createRunningDeployment(deploymentId);

      getK8sClientsStub = sinon.stub(serviceImageTags, 'getK8sClients').returns(fakeK8sClients({
        createNamespacedJob: sinon.stub().rejects(new Error('jobs.batch is forbidden: User cannot create resource')),
      }));

      await serviceImageTags.runDeployJob(
        fakeDeployRequest(), 'harmony-service-example', 'foo', deploymentId, 'latest');
    });

    it('marks the deployment failed with the error message in the log', async function () {
      let deployment;
      await db.transaction(async (tx) => {
        deployment = await getDeploymentById(tx, deploymentId);
      });
      expect(deployment.status).to.equal('failed');
    });
  });

  describe('when the Job polling times out', function () {
    let deploymentId: string;
    let clock: sinon.SinonFakeTimers;

    beforeEach(async function () {
      deploymentId = uuid();
      await createRunningDeployment(deploymentId);

      getK8sClientsStub = sinon.stub(serviceImageTags, 'getK8sClients').returns(fakeK8sClients({
        readNamespacedJob: sinon.stub().resolves({ status: {} }),
      }));
    });

    afterEach(function () {
      if (clock) {
        clock.restore();
        clock = undefined;
      }
    });

    it('eventually marks the deployment failed without an unhandled rejection', async function () {
      clock = sinon.useFakeTimers();
      const runPromise = serviceImageTags.runDeployJob(
        fakeDeployRequest(), 'harmony-service-example', 'foo', deploymentId, 'latest');
      // advance well past the 20 minute poll timeout
      await clock.tickAsync(21 * 60 * 1000);
      await runPromise;

      let deployment;
      await db.transaction(async (tx) => {
        deployment = await getDeploymentById(tx, deploymentId);
      });
      expect(deployment.status).to.equal('failed');

      const logs = await objectStoreForProtocol('s3')
        .getObjectJson(`s3://${env.artifactBucket}/${deploymentId}/log.json`) as string[];
      expect(logs.some((line) => line.includes('Timed out waiting for job'))).to.be.true;
    });
  });
});

describe('get service deployments state with cookie-secret', async function () {
  beforeEach(function () {
    process.env.COOKIE_SECRET = 'cookie-secret-value';
  });

  hookServersStartStop();

  describe('when incorrect cookie-secret header is provided', async function () {
    before(async function () {
      this.res = await request(this.frontend)
        .get('/service-deployments-state')
        .set('cookie-secret', 'wrong_secret');
    });

    after(function () {
      delete this.res;
    });

    it('rejects the request', async function () {
      expect(this.res.status).to.equal(403);
    });

    it('returns a meaningful error message', async function () {
      expect(this.res.text).to.equal('User anonymous does not have permission to access this resource');
    });
  });

  describe('when correct cookie-secret header is provided', async function () {
    before(async function () {
      this.res = await request(this.frontend)
        .get('/service-deployments-state')
        .set('cookie-secret', process.env.COOKIE_SECRET);
    });

    after(function () {
      delete this.res;
    });

    it('returns a status 200', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('returns the service enabled true', async function () {
      expect(this.res.body.enabled).to.eql(true);
    });
  });
});

describe('Update service deployments state with cookie-secret', async function () {
  beforeEach(function () {
    process.env.COOKIE_SECRET = 'cookie-secret-value';
  });

  hookServersStartStop();

  describe('when incorrect cookie-secret header is provided', async function () {
    before(async function () {
      this.res = await request(this.frontend)
        .put('/service-deployments-state')
        .send({ enabled: true })
        .set('cookie-secret', 'wrong_secret')
        .set('Content-Type', 'application/json');
    });

    after(function () {
      delete this.res;
    });

    it('rejects the request', async function () {
      expect(this.res.status).to.equal(403);
    });

    it('returns a meaningful error message', async function () {
      expect(this.res.text).to.equal('User anonymous does not have permission to access this resource');
    });
  });

  describe('when correct cookie-secret header is provided', async function () {
    before(async function () {
      this.res = await request(this.frontend)
        .put('/service-deployments-state')
        .send({ enabled: true })
        .set('cookie-secret', process.env.COOKIE_SECRET)
        .set('Content-Type', 'application/json');
    });

    after(function () {
      delete this.res;
    });

    it('returns a status 200', async function () {
      expect(this.res.status).to.equal(200);
    });

    it('returns the service enabled true', async function () {
      expect(this.res.body.enabled).to.eql(true);
    });
  });
});

describe('Service self-deployment with cookie-secret', async function () {
  beforeEach(function () {
    process.env.COOKIE_SECRET = 'cookie-secret-value';
  });

  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('when incorrect cookie-secret header is provided', async function () {
    before(async function () {
      this.res = await request(this.frontend)
        .put('/service-image-tag/harmony-service-example')
        .set('cookie-secret', 'wrong_secret')
        .send({ tag: 'foo' });
    });

    after(function () {
      delete this.res;
    });

    it('rejects the request', async function () {
      expect(this.res.status).to.equal(403);
    });

    it('returns a meaningful error message', async function () {
      expect(this.res.text).to.equal('User undefined does not have permission to access this resource');
    });
  });

  describe('when correct cookie-secret header is provided', async function () {
    let execStub;
    let execDeployScriptStub: sinon.SinonStub;
    let link = null;
    let linkDeploymentId = null;
    let deploymentLogPath = null;

    hookDescribeImage({
      imageDigest: '',
      lastUpdated: undefined,
    });

    before(async function () {
      // resolve without error meaning script executed OK
      execStub = sinon.stub(serviceImageTags, 'asyncExec').callsFake(() => Promise.resolve({}));

      // Stub out the exec function to simulate successful execution
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      execDeployScriptStub = sinon.stub(require('child_process'), 'exec');
      execDeployScriptStub.callsArgWith(2, null, 'Success output', '');

      this.res = await request(this.frontend)
        .put('/service-image-tag/harmony-service-example')
        .set('cookie-secret', process.env.COOKIE_SECRET)
        .send({ tag: 'foo' });
    });

    after(function () {
      execStub.restore();
      execDeployScriptStub.restore();
      delete this.res;
    });

    it('returns a status 202', async function () {
      expect(this.res.status).to.equal(202);
    });

    it('returns the tag we sent', async function () {
      expect(this.res.body.tag).to.eql('foo');
    });

    it('returns statusLink', async function () {
      link = this.res.body.statusLink;
      expect(link).to.include('http://127.0.0.1:4000/service-deployment/');
      linkDeploymentId = getDeploymentIdFromStatusLink(link);
      expect(linkDeploymentId).to.not.be.null;
    });

    it('reaches a terminal status without timeout', async function () {
      const noTimeout = await waitUntilStatusChange(linkDeploymentId);
      expect(noTimeout).to.be.true;
    });

    describe('when get the status of successful deployment done with cookie secret', async function () {
      before(async function () {
        hookRedirect('buzz');
        const { pathname } = new URL(link);
        this.res = await request(this.frontend).get(pathname).use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a status 200', async function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the deployment status successful', async function () {
        const { deploymentId, username, service, tag, regressionTestVersion, status, message } = this.res.body;
        deploymentLogPath = `/deployment-logs/${deploymentId}`;
        expect(deploymentId).to.eql(linkDeploymentId);
        expect(username).to.eql('cookie_secret');
        expect(service).to.eql('harmony-service-example');
        expect(tag).to.eql('foo');
        // regressionTestVersion is set to the default value
        expect(regressionTestVersion).to.eql('latest');
        expect(status).to.eql('successful');
        expect(message).to.include('Deployment successful');
        expect(message).to.include(`See details at: http://127.0.0.1:4000${deploymentLogPath}`);
      });
    });
  });
});
