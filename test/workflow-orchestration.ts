import { expect } from 'chai';
import { getWorkflowStepsByJobId } from 'models/workflow-steps';
import db from 'util/db';
import { hookRedirect } from './helpers/hooks';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';

describe('Workflow chaining for a collection configured for swot reprojection and netcdf-to-zarr', function () {
  const collection = 'C1233800302-EEDTEST';
  hookServersStartStop();

  describe('when requesting to reformat to zarr, no reprojection', function () {
    const zarrOnlyQuery = {
      maxResults: 2,
      format: 'application/x-zarr',
      turbo: true,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: zarrOnlyQuery, username: 'joe' });
    hookRedirect('joe');

    it('generates a workflow with 2 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(2);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('harmonyservices/netcdf-to-zarr:latest');
    });
  });

  describe('when requesting to reproject, but not reformat', function () {
    const reprojectOnlyQuery = {
      maxResults: 2,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-netcdf4',
      turbo: true,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectOnlyQuery });
    hookRedirect('joe');

    it('generates a workflow with 2 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(2);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reprojection using swot reprojection', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('sds/swot-reproject:latest');
    });
  });

  describe('when requesting to both reproject and reformat', function () {
    const reprojectAndZarrQuery = {
      maxResults: 2,
      outputCrs: 'EPSG:4326',
      interpolation: 'near',
      scaleExtent: '0,2500000.3,1500000,3300000',
      scaleSize: '1.1,2',
      format: 'application/x-zarr',
      turbo: true,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectAndZarrQuery });
    hookRedirect('joe');

    it('generates a workflow with 3 steps', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps.length).to.equal(3);
    });

    it('starts with the query-cmr task', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[0].serviceID).to.equal('harmonyservices/query-cmr:latest');
    });

    it('then requests reprojection using swot reprojection', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[1].serviceID).to.equal('sds/swot-reproject:latest');
    });

    it('then requests reformatting using netcdf-to-zarr', async function () {
      const job = JSON.parse(this.res.text);
      const workflowSteps = await getWorkflowStepsByJobId(db, job.jobID);

      expect(workflowSteps[2].serviceID).to.equal('harmonyservices/netcdf-to-zarr:latest');
    });
  });
});
