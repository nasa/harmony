import { expect } from 'chai';
import request from 'supertest';
import hookServersStartStop from './helpers/servers';
import { getServiceConfigs } from '../app/models/services';
import { ServiceConfig } from '../app/models/services/base-service';

const serviceName = 'gesdisc/giovanni';
const serviceNewTag = 'harmonyservices/giovanni-adapter:newtag';

const callbackMessage = {
  deployService: 'giovanni-adapter',
  image: serviceNewTag,
  serviceQueueUrls: ['harmonyservices/giovanni-adapter:latest,https://sqs.us-west-2.amazonaws.com/123456/giovanni-adapter-latest-0-sandbox'],
};

/**
 * Retruns the first image in the steps of the target service name in the given configs.
 * @param configs - The service configs
 * @param targetName  - The target service name
 * @returns the image name
 */
function findImageByName(configs: ServiceConfig<unknown>[], targetName: string): string | undefined {
  for (const config of configs) {
    if (config.name === targetName) {
      // Assuming the first step has the desired image
      const firstStep = config.steps[0];
      if (firstStep && firstStep.image) {
        return firstStep.image;
      }
    }
  }
  return undefined;
}

describe('Deployment callback endpoint', async function () {
  hookServersStartStop();
  let originalEnv;
  before(function () {
    // Save the original process.env
    originalEnv = process.env;
    process.env.COOKIE_SECRET = 'secret-value';
  });

  after(function () {
    // Restore the original process.env after test
    process.env = originalEnv;
  });

  describe('handle callback message', function () {

    describe('when no cookie-secret header is provided', async function () {
      before(async function () {
        this.res = await request(this.backend)
          .post('/service/deployment-callback')
          .send(callbackMessage)
          .set('Content-Type', 'application/json');
      });

      after(function () {
        delete this.res;
      });

      it('rejects the request', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('You do not have permission to call deployment-callback endpoint');
      });
    });

    describe('when wrong cookie-secret header is provided', async function () {
      before(async function () {
        this.res = await request(this.backend)
          .post('/service/deployment-callback')
          .send(callbackMessage)
          .set('cookie-secret', 'wrong-secret-value')
          .set('Content-Type', 'application/json');
      });

      after(function () {
        delete this.res;
      });

      it('rejects the request', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal('You do not have permission to call deployment-callback endpoint');
      });
    });

    describe('when correct cookie-secret header is provided', async function () {
      let configs: ServiceConfig<unknown>[] = null;
      before(async function () {
        configs = getServiceConfigs();
        this.res = await request(this.backend)
          .post('/service/deployment-callback')
          .send(callbackMessage)
          .set('cookie-secret', 'secret-value')
          .set('Content-Type', 'application/json');
      });

      after(function () {
        delete this.res;
      });

      it('runs the request successfully', async function () {
        expect(this.res.status).to.equal(201);
      });

      it('returns OK', async function () {
        expect(this.res.text).to.equal('OK');
      });

      it('updates the image tag', async function () {
        let serviceImage = findImageByName(configs, serviceName);
        expect(serviceImage).to.equal('harmonyservices/giovanni-adapter:latest');
        // get the service config again and verify that it is updated to the new tag
        serviceImage = findImageByName(getServiceConfigs(), serviceName);
        expect(serviceImage).to.equal(serviceNewTag);
      });
    });
  });
});
