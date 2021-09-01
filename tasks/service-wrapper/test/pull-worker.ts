import { expect } from 'chai';
import { describe, it } from 'mocha';
import WorkItem from '../../../app/models/work-item';
import { hookGetWorkRequest } from './helpers/pull-worker';
import { exportedForTesting } from '../app/workers/pull-worker';

const { _pullWork } = exportedForTesting;

describe('Pull Worker', async function () {
  (describe('pullWork', async function () {
    (describe('when work is available', async function () {
      const workItem = new WorkItem({
        jobID: '123',
        serviceID: 'abc',
        workflowStepIndex: 1,
      });

      hookGetWorkRequest(200, workItem);

      it('returns a 200 status', async function () {
        const work = await _pullWork();
        expect(work.status).to.equal(200, 'Expected a 200 status when work is available');
      });

      it('returns a work item', async function () {
        const work = await _pullWork();
        expect(work.item).to.eql(workItem, 'Expected a work item');
      });
    }));
    (describe('when work is not available', async function () {
      hookGetWorkRequest(404, null);

      it('returns a 404 status', async function () {
        const work = await _pullWork();
        expect(work.status).to.equal(404, 'Expected a 404 status when work is not available');
      });
    }));
  }));
});
