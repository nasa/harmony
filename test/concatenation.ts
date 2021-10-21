import { expect } from 'chai';
// import { getWorkItemsByJobId, WorkItemStatus } from '../app/models/work-item';
import { getWorkflowStepsByJobId } from '../app/models/workflow-steps';
import db from '../app/util/db';
// import { Job, JobStatus } from '../app/models/job';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest, rangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
// import { getWorkForService, hookGetWorkForService, updateWorkItem } from './helpers/work-items';


describe('CONCISE workflow', function () {
  const collection = 'C1234208438-POCLOUD';
  const serviceTag = 'ghcr.io/podaac/concise:sit';

  describe('When the concatenate parameter', function () {
    hookServersStartStop();
    describe('is not set', function () {
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

    describe('is set to false', function () {
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

    describe('is set to true', function () {
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

    describe('is set to something besides true or false', function () {
      const query = {
        concatenate: 'random',
        maxResults: 2,
        turbo: true,
      };
      // hookRangesetRequest('1.0.0', collection, 'all', { query });
      // hookRedirect('anonymous');

      it('invokes the service', async function () {
        const res = await rangesetRequest(
          this.frontend,
          '1.0.0',
          collection,
          'all',
          { query },
        );

        expect(res.statusCode).to.eql(400);
        expect(res.text).to.eql('{"code":"harmony.RequestValidationError","description":"Error: query parameter \\"concatenate\\" unable to parse \'concatenate\' from value \\"random\\""}');
      });
    });
  });

});