import { expect } from 'chai';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import db from '../app/util/db';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest, rangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import StubService from './helpers/stub-service';


describe('CONCISE workflow', function () {
  const collection = 'C1234208438-POCLOUD';
  const serviceTag = 'ghcr.io/podaac/concise:sit';

  describe('When passing the concatenate parameter', function () {
    hookServersStartStop();

    describe('calling the backend service', function () {
      const query = {
        concatenate: true,
        maxResults: 2,
        turbo: true,
      };
      StubService.hook({ params: { redirect: 'http://example.com' } });
      hookRangesetRequest('1.0.0', collection, 'all', { query });
      it('sets the concatenate flag on the operation', function () {
        expect(this.service.operation.shouldConcatenate).to.equal(true);
      });
    });


    describe('and it is not set', function () {
      const query = {
        maxResults: 2,
        turbo: true,
      };
      hookRangesetRequest('1.0.0', collection, 'all', { query });
      hookRedirect('anonymous');

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
      hookRangesetRequest('1.0.0', collection, 'all', { query });
      hookRedirect('anonymous');

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
      hookRangesetRequest('1.0.0', collection, 'all', { query });
      hookRedirect('anonymous');

      it('invokes the service', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].serviceID).to.eql(serviceTag);
      });
    });

    describe('and it is set to something besides true or false', function () {
      const query = {
        concatenate: 'random',
        maxResults: 2,
        turbo: true,
      };

      it('invokes the service', async function () {
        const res = await rangesetRequest(
          this.frontend,
          '1.0.0',
          collection,
          'all',
          { query },
        );

        expect(res.statusCode).to.eql(400);
        expect(res.body).to.eql({
          code: 'harmony.RequestValidationError',
          description: 'Error: query parameter "concatenate" unable to parse \'concatenate\' from value "random"',
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

      it('returns a Not Found Error', async function () {
        const res = await rangesetRequest(
          this.frontend,
          '1.0.0',
          nonConcatCollection,
          'all',
          { query },
        );

        expect(res.statusCode).to.eql(404);
        expect(res.body).to.eql({
          code: 'harmony.NotFoundError',
          description: 'Error: no matching service',
        });
      });
    });
  });
});