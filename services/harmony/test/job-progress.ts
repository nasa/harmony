import { expect } from 'chai';
import db from '../app/util/db';
import { Job  } from '../app/models/job';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import { getWorkForService, updateWorkItem, fakeServiceStacOutput } from './helpers/work-items';
import { getStacLocation, WorkItemStatus } from '../app/models/work-item-interface';
import { truncateAll } from './helpers/db';

describe('Testing job progress', function () {
  const collection = 'C1234208438-POCLOUD';
  describe('when making a sub-setting request with no concatenation', async function () {
    hookServersStartStop();
    const reprojectQuery = {
      maxResults: 2,
      subset: 'lat(0:90)',
      concatenate: false,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectQuery });

    describe('when the query-cmr work-item is retrieved and processed', async function () {
      it('sets the job progress to 50', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem } = JSON.parse(res.text);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
          ];
        workItem.outputItemSizes = [1, 2];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);

        await updateWorkItem(this.backend, workItem);
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.progress).to.equal(50);
      });

      describe('when the first sub-setter work-item is retrieved and processed', async function () {
        it('sets the job progress to 75', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
             getStacLocation(workItem, 'catalog.json'),
          ];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
          const jobs = await Job.forUser(db, 'anonymous');
          const job = jobs.data[0];
          expect(job.progress).to.equal(75);

        });
      });

      describe('when the second sub-setter work-item is retrieved and processed', async function () {
        it('sets the job progress to 100', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
             getStacLocation(workItem, 'catalog.json'),
          ];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
          const jobs = await Job.forUser(db, 'anonymous');
          const job = jobs.data[0];
          expect(job.progress).to.equal(100);

        });
      });

    });
  });

  describe('when making a sub-setting request with concatenation', async function () {
    hookServersStartStop();
    const reprojectQuery = {
      maxResults: 2,
      subset: 'lat(0:90)',
      concatenate: true,
    };

    hookRangesetRequest('1.0.0', collection, 'all', { query: reprojectQuery });

    describe('when the query-cmr work-item is retrieved and processed', async function () {
      it('sets the job progress to 33', async function () {
        const res = await getWorkForService(this.backend, 'harmonyservices/query-cmr:latest');
        const { workItem } = JSON.parse(res.text);
        workItem.status = WorkItemStatus.SUCCESSFUL;
        workItem.results = [
            getStacLocation(workItem, 'catalog0.json'),
            getStacLocation(workItem, 'catalog1.json'),
          ];
        workItem.outputItemSizes = [1, 2];
        await fakeServiceStacOutput(workItem.jobID, workItem.id, 2, 1);

        await updateWorkItem(this.backend, workItem);
        const jobs = await Job.forUser(db, 'anonymous');
        const job = jobs.data[0];
        expect(job.progress).to.equal(33);
      });

      // FIXME for some reason I'm seeing logs that the work item updates are failing, even though
      // they are set to 'success' in the dB

      describe('when the first sub-setter work-item is retrieved and processed', async function () {
        it('sets the job progress to 50', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
             getStacLocation(workItem, 'catalog.json'),
          ];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
          const jobs = await Job.forUser(db, 'anonymous');
          const job = jobs.data[0];
          expect(job.progress).to.equal(50);
        });
      });

      describe('when the second sub-setter work-item is retrieved and processed', async function () {
        it('sets the job progress to 66', async function () {
          const res = await getWorkForService(this.backend, 'ghcr.io/podaac/l2ss-py:sit');
          const { workItem } = JSON.parse(res.text);
          workItem.status = WorkItemStatus.SUCCESSFUL;
          workItem.results = [
             getStacLocation(workItem, 'catalog.json'),
          ];
          workItem.outputItemSizes = [1];
          await fakeServiceStacOutput(workItem.jobID, workItem.id, 1, 1);
          await updateWorkItem(this.backend, workItem);
          const jobs = await Job.forUser(db, 'anonymous');
          const job = jobs.data[0];
          expect(job.progress).to.equal(66);
        });
      });
    });
  });
});
