import { expect } from 'chai';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import db from '../app/util/db';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import StubService from './helpers/stub-service';


describe('CONCISE workflow', function () {
  const collection = 'C1234208438-POCLOUD';
  const serviceTag = 'ghcr.io/podaac/concise:sit';

  describe('When passing the concatenate parameter', function () {
    hookServersStartStop({ skipEarthdataLogin: false });

    describe('calling the backend service', function () {
      const query = {
        concatenate: true,
        maxResults: 2,
        turbo: true,
      };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      it('sets the concatenate flag on the operation', function () {
        expect(this.service.operation.shouldConcatenate).to.equal(true);
      });
    });

    describe('and it is not set', function () {
      const query = {
        maxResults: 2,
        turbo: true,
      };
      hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      hookRedirect('joe');

      it('does not invoke the service', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps.find((value): boolean => value.serviceID === serviceTag)).to.be.undefined;
      });
    });

    describe('and it is set to false', function () {
      const query = {
        concatenate: false,
        maxResults: 2,
        turbo: true,
      };
      hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      hookRedirect('joe');

      it('does not invoke the service', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps.find((value): boolean => value.serviceID === serviceTag)).to.be.undefined;
      });
    });

    describe('and it is set to true', function () {
      const query = {
        concatenate: true,
        maxResults: 2,
        turbo: true,
      };
      hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      hookRedirect('joe');

      it('invokes the service', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].serviceID).to.eql(serviceTag);
      });
    });

    describe('and it is set to something besides true or false', function () {
      const badQuery = {
        concatenate: 'random',
        maxResults: 2,
        turbo: true,
      };

      hookRangesetRequest('1.0.0', collection, 'all', { query: badQuery, username: 'joe' });

      it('returns an error', async function () {

        expect(this.res.statusCode).to.equal(400);
        expect(this.res.body).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: query parameter "concatenate" must be \'false\' or \'true\'',
        });
      });
    });

    describe('is requested for a collection that has no service that provides concatenation', function () {
      const nonConcatCollection = 'C1233800302-EEDTEST';
      const query = {
        concatenate: 'true',
        maxResults: 2,
        turbo: true,
      };

      hookRangesetRequest('1.0.0', nonConcatCollection, 'all', { query, username: 'joe' });

      it('returns a Not Found Error', async function () {

        expect(this.res.statusCode).to.eql(404);
        expect(this.res.body).to.eql({
          code: 'harmony.NotFoundError',
          description: 'Error: no matching service',
        });
      });
    });
  });
});