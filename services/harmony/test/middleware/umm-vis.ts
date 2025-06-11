import { expect } from 'chai';

import DataOperation from '../../app/models/data-operation';
import { getWorkflowStepsByJobId } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';

const collectionId = 'C1273843214-EEDTEST';
const validVariable = 'blue_var';

describe('UMM-Vis', function () {
  hookServersStartStop();
  describe('When `all` is given as the variable', function () {
    hookRangesetRequest('1.0.0', collectionId, 'all', { query: {}, username: 'joe' });

    it('the data operation contains the collletions visualization records at the top-level in the source', async function () {
      const job = JSON.parse(this.res.text);
      console.log(`JOB: ${JSON.stringify(job)}`);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
      const operation = JSON.parse(workflowSteps[0].operation) as DataOperation;
      expect(operation.sources[0].visualizations.length).equals(2);
    });

  });
  describe('When a variable is specified in the url', function () {
    hookRangesetRequest('1.0.0', collectionId, validVariable, { query: {}, username: 'joe' });
    describe('and a service requests work', function () {
      it('the data operation contains the variable visaulization records underneath the variable in the source', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
        const operation = JSON.parse(workflowSteps[0].operation) as DataOperation;
        expect(operation.sources[0].variables[0].visualizations.length).equals(2);
      });
      it('the data operation does not include the collection visualizations', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
        const operation = JSON.parse(workflowSteps[0].operation) as DataOperation;
        expect(operation.sources[0].visualizations.length).equals(0);
      });
    });
  });

  describe('When a variable is specified in the query parameters', function () {
    hookRangesetRequest('1.0.0', collectionId, 'query_parameters', { query: { variable: validVariable }, username: 'joe' });
    describe('and a service requests work', function () {
      it('the data operation contains the variable visaulization records underneath the variable in the source', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
        const operation = JSON.parse(workflowSteps[0].operation) as DataOperation;
        expect(operation.sources[0].variables[0].visualizations.length).equals(2);
      });
      it('the data operation does not include the collection visualizations', async function () {
        const job = JSON.parse(this.res.text);
        const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);
        const operation = JSON.parse(workflowSteps[0].operation) as DataOperation;
        expect(operation.sources[0].visualizations.length).equals(0);
      });
    });
  });
});