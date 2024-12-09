import { expect } from 'chai';
import request from 'supertest';
import hookServersStartStop from './helpers/servers';
import { getServiceConfigs } from '../app/models/services';
import { ServiceConfig } from '../app/models/services/base-service';

const serviceName = 'harmony/service-example';
const serviceNewTag = 'harmonyservices/service-example:newtag';

const callbackMessage = {
  deployService: 'harmony-service-example',
  image: serviceNewTag,
  serviceQueueUrls: '["harmonyservices/harmony-service-example:test,https://sqs.us-west-2.amazonaws.com/123456/harmony-service-example-test-0-sandbox"]',
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
      // Assuming the second step has the desired image
      const secondStep = config.steps[1];
      if (secondStep && secondStep.image) {
        return secondStep.image;
      }
    }
  }


  return undefined;
}

describe('Deployment callback endpoint', async function () {
  hookServersStartStop();
  let originalImage;
  before(function () {
    // Save the original process.env
    originalImage = process.env.HARMONY_SERVICE_EXAMPLE_IMAGE;
  });

  after(function () {
    // Restore the original process.env after test
    process.env.HARMONY_SERVICE_EXAMPLE_IMAGE = originalImage;
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
          .set('cookie-secret', process.env.COOKIE_SECRET)
          .set('Content-Type', 'application/json');
      });

      after(async function () {
        delete this.res;
        // Set the image back to the original tag to prevent breaking other tests outside this file
        // loadServiceConfigs(env.cmrEndpoint);
        const originalImageCallback = callbackMessage;
        originalImageCallback.image = 'harmonyservices/service-example:latest';
        await request(this.backend)
          .post('/service/deployment-callback')
          .send(originalImageCallback)
          .set('cookie-secret', process.env.COOKIE_SECRET)
          .set('Content-Type', 'application/json');
      });

      it('runs the request successfully', async function () {
        expect(this.res.status).to.equal(201);
      });

      it('returns OK', async function () {
        expect(this.res.text).to.equal('OK');
      });

      it('updates the image tag', async function () {
        let serviceImage = findImageByName(configs, serviceName);
        expect(serviceImage).to.equal('harmonyservices/service-example:latest');
        // get the service config again and verify that it is updated to the new tag
        serviceImage = findImageByName(getServiceConfigs(), serviceName);
        expect(serviceImage).to.equal(serviceNewTag);
      });
    });
  });
});
