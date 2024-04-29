import { expect } from 'chai';
import ServiceDeployment, { ServiceDeploymentStatus } from '../app/models/service-deployment';
import { auth } from './helpers/auth';
import { hookTransaction } from './helpers/db';
import { hookRedirect } from './helpers/hooks';
import hookServersStartStop from './helpers/servers';
import request from 'supertest';

const userErrorMsg = 'User joe is not in the service deployers or admin EDL groups';

describe('List service deployments endpoint', async function () {
  const failedFooDeployment = new ServiceDeployment({ deployment_id: 'abc', service: 'foo-service',
    username: 'bob', tag: '1', status: ServiceDeploymentStatus.FAILED, message: 'Failed service deployment'  });

  const successfulFooDeployment = new ServiceDeployment({
    deployment_id: 'def', service: 'foo-service',
    username: 'eve', tag: '1', status: ServiceDeploymentStatus.SUCCESSFUL, message: 'Deployment successful',
  });

  const runningFooDeployment = new ServiceDeployment({
    deployment_id: 'jkl', service: 'foo-service',
    username: 'adam', tag: '1', status: ServiceDeploymentStatus.RUNNING, message: 'Deployment running',
  });

  const successfulBuzzDeployment = new ServiceDeployment({
    deployment_id: 'ghi', service: 'buzz-service',
    username: 'joe', tag: '1', status: ServiceDeploymentStatus.SUCCESSFUL, message: 'Deployment successful',
  });

  const runningBuzzDeployment = new ServiceDeployment({
    deployment_id: 'jkl', service: 'buzz-service',
    username: 'adam', tag: '1', status: ServiceDeploymentStatus.RUNNING, message: 'Deployment running',
  });


  let allServicesListing;
  let fooServiceListing;
  let buzzServiceListing;
  let successfulServicesListing;
  let runningServicesListing;
  let failedServicesListing;
  let runningAndFooServiceListing;

  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();

  before(async function () {
    await failedFooDeployment.save(this.trx);
    await successfulFooDeployment.save(this.trx);
    await runningFooDeployment.save(this.trx);
    await successfulBuzzDeployment.save(this.trx);
    await runningBuzzDeployment.save(this.trx);
    this.trx.commit();
    allServicesListing = JSON.stringify([failedFooDeployment, successfulFooDeployment, runningFooDeployment, successfulBuzzDeployment, runningBuzzDeployment]
      .map((deployment) => deployment.serialize()));
    fooServiceListing = JSON.stringify([failedFooDeployment, successfulFooDeployment, runningFooDeployment]
      .map((deployment) => deployment.serialize()));
    buzzServiceListing = JSON.stringify([successfulBuzzDeployment, runningBuzzDeployment]
      .map((deployment) => deployment.serialize()));
    successfulServicesListing = JSON.stringify([successfulFooDeployment, successfulBuzzDeployment]
      .map((deployment) => deployment.serialize()));
    runningServicesListing = JSON.stringify([runningFooDeployment, runningBuzzDeployment]
      .map((deployment) => deployment.serialize()));
    failedServicesListing = JSON.stringify([failedFooDeployment]
      .map((deployment) => deployment.serialize()));
    runningAndFooServiceListing = JSON.stringify([runningFooDeployment]
      .map((deployment) => deployment.serialize()));
  });
  after(function () {

  });

  describe('when a user is not in the EDL service deployers or admin groups', async function () {
    before(async function () {
      hookRedirect('joe');
      this.res = await request(this.frontend).get('/service-deployment').use(auth({ username: 'joe' }));
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
    describe('and they request all service deployments', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(allServicesListing);
      });
    });

    describe('and they request deployments of a specific service', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?service=foo-service').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(fooServiceListing);
      });
    });

    describe('and they request deployments with a running status', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=running').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(runningServicesListing);
      });
    });

    describe('and they request deployments with a failed status', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=failed').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(failedServicesListing);
      });
    });

    describe('and they request deployments with a specific status for a specific service and there is a match', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=running&service=foo-service').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns the matching deployments', function () {
        expect(this.res.text).to.equal(runningAndFooServiceListing);
      });
    });

    describe('and they request deployments with a specific status for a specific service and there is no match', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=failed&service=buzz-service').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns zero deployments', function () {
        expect(this.res.text).to.equal('[]');
      });
    });

    describe('and they request deployments with mixed case status', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=RuNning').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(runningServicesListing);
      });
    });

    describe('and they request deployments with an invalid status', function () {
      before(async function () {
        hookRedirect('eve');
        this.res = await request(this.frontend).get('/service-deployment?status=foo').use(auth({ username: 'eve' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns an error status', function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a valid error message', function () {
        expect(this.res.text).to.equal('"foo" is not a valid deployment status. Valid statuses are ["running","successful","failed"]');
      });
    });
  });

  describe('when a user is in the EDL admin group', async function () {
    describe('and they request all service deployments', function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-deployment').use(auth({ username: 'adam' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(allServicesListing);
      });
    });

    describe('and they request deployments of a specific service', function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-deployment?service=buzz-service').use(auth({ username: 'adam' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(buzzServiceListing);
      });
    });

    // HARMONY-1749
    describe('and they request deployments with a specific status', function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-deployment?status=successful').use(auth({ username: 'adam' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a success status', function () {
        expect(this.res.status).to.equal(200);
      });

      it('returns all the deployments', function () {
        expect(this.res.text).to.equal(successfulServicesListing);
      });
    });

    describe('and they request deployments with an invalid status', function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-deployment?status=bar').use(auth({ username: 'adam' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns an error status', function () {
        expect(this.res.status).to.equal(400);
      });

      it('returns a valid error message', function () {
        expect(this.res.text).to.equal('"bar" is not a valid deployment status. Valid statuses are ["running","successful","failed"]');
      });
    });

  });
});