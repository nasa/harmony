import { expect } from 'chai';
import { getWorkflowStepsByJobId } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import { hookRedirect } from '../helpers/hooks';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

describe('testing concatenation', function () {
  describe('for a CONCISE workflow', function () {
    const collection = 'C1243729749-EEDTEST';
    const serviceTag = 'ghcr.io/podaac/concise:sit';

    describe('When passing the concatenate parameter', function () {
      hookServersStartStop({ USE_EDL_CLIENT_APP: true });

      describe('calling the backend service', function () {
        const query = {
          concatenate: true,
          maxResults: 2,
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
        };
        hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
        hookRedirect('joe');

        it('does not invoke the service', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps.find((value): boolean => value.serviceID === serviceTag)).to.be.undefined;
        });

        it('has the `hasAggregatedOutput` flag set to false on the workflow step', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
          expect(workflowSteps[0].hasAggregatedOutput).to.equal(0);
        });
      });

      describe('and it is set to false', function () {
        const query = {
          concatenate: false,
          maxResults: 2,
        };
        hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
        hookRedirect('joe');

        it('does not invoke the service', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps.find((value): boolean => value.serviceID === serviceTag)).to.be.undefined;
        });

        it('has the `hasAggregatedOutput` flag set to false on the workflow step', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps[0].hasAggregatedOutput).to.equal(0);
        });
      });

      describe('and it is set to true', function () {
        const query = {
          concatenate: true,
          maxResults: 2,
        };
        hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
        hookRedirect('joe');

        it('invokes the service', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps[1].serviceID).to.eql(serviceTag);
        });

        it('has the `hasAggregatedOutput` flag set to true on the workflow step', async function () {
          const job = JSON.parse(this.res.text);
          const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

          expect(workflowSteps[1].hasAggregatedOutput).to.equal(1);
        });
      });

      describe('and it is set to something besides true or false', function () {
        const badQuery = {
          concatenate: 'random',
          maxResults: 2,
        };

        hookRangesetRequest('1.0.0', collection, 'all', { query: badQuery, username: 'joe' });

        it('returns an error', async function () {
          expect(this.res.statusCode).to.equal(400);
          expect(this.res.body).to.eql({
            code: 'harmony.RequestValidationError',
            description: 'Error: query parameter \"concatenate\" must be either true or false',
          });
        });
      });

      describe('is requested for a collection that has no service that provides concatenation', function () {
        const nonConcatCollection = 'C1104-PVC_TS2';
        const query = {
          concatenate: 'true',
          maxResults: 2,
        };

        hookRangesetRequest('1.0.0', nonConcatCollection, 'all', { query, username: 'joe' });

        it('returns a 422 unprocessable status code', async function () {
          expect(this.res.statusCode).to.eql(422);
        });

        it('returns a message indicating no service could process the request', async function () {
          expect(this.res.body).to.eql({
            code: 'harmony.UnsupportedOperation',
            description: 'Error: the requested combination of operations: concatenation on C1104-PVC_TS2 is unsupported',
          });
        });
      });
    });
  });

  describe('for an L2 subsetter to CONCISE workflow', function () {
    const collection = 'C1243729749-EEDTEST';
    const l2SubsetterImage = 'ghcr.io/podaac/l2ss-py:sit';
    const conciseImage = 'ghcr.io/podaac/concise:sit';

    describe('When passing the concatenate parameter and spatial subsetting', function () {
      hookServersStartStop( { USE_EDL_CLIENT_APP: true });
      const query = {
        concatenate: true,
        subset: 'lat(0:90)',
        maxResults: 3,
      };

      describe('priming the test so it works... this is meaningless, but workflow steps are not created by later tests without it', function () {
        StubService.hook({ params: { redirect: 'http://example.com' } });
        hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      });

      hookRangesetRequest('1.0.0', collection, 'all', { query, username: 'joe' });
      hookRedirect('joe');

      it('includes a workflow step to invoke the l2-subsetter service first', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
        expect(workflowSteps[1].serviceID).to.eql(l2SubsetterImage);
      });

      it('does not set the `hasAggregatedOutput` flag on the l2-subsetter workflow step', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[1].hasAggregatedOutput).to.equal(0);
      });

      it('includes a workflow step to invoke the concise service', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[2].serviceID).to.eql(conciseImage);
      });

      it('has the `hasAggregatedOutput` flag set to true on the concise workflow step', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

        expect(workflowSteps[2].hasAggregatedOutput).to.equal(1);
      });
    });
  });
});
