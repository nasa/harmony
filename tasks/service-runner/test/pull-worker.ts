import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import env from '../app/util/env';
import WorkItem from '../../../app/models/work-item';
import { hookGetWorkRequest } from './helpers/pull-worker';
import * as pullWorker from '../app/workers/pull-worker';
import PullWorker from '../app/workers/pull-worker';
import * as serviceRunner from '../app/service/service-runner';

const { _pullWork, _doWork, _primeCmrService, _primeService } = pullWorker.exportedForTesting;

describe('Pull Worker', async function () {
  describe('on start', async function () {
    let queryCmrSpy: sinon.SinonSpy;
    let serviceSpy: sinon.SinonSpy;
    const invocArgs = env.invocationArgs;
    beforeEach(function () {
      queryCmrSpy = sinon.spy(pullWorker.exportedForTesting, '_primeCmrService');
      serviceSpy = sinon.spy(pullWorker.exportedForTesting, '_primeService');

      env.invocationArgs = 'abc\n123';
    });

    afterEach(function () {
      env.invocationArgs = invocArgs;
      queryCmrSpy.restore();
      serviceSpy.restore();
    });

    describe('when the service is query-cmr', async function () {
      it('primes the CMR service', async function () {
        env.harmonyService = 'harmonyservices/query-cmr:latest';
        const worker = new PullWorker();
        await worker.start(false);
        expect(queryCmrSpy.called).to.be.true;
      });
    });

    describe('when the service is not query-cmr', async function () {
      it('primes the service', async function () {
        env.harmonyService = 'foo:latest';
        const worker = new PullWorker();
        await worker.start(false);
        expect(serviceSpy.called).to.be.true;
      });
    });
  });

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

  describe('pull and do work', async function () {
    let queryCmrSpy: sinon.SinonSpy;
    let serviceSpy: sinon.SinonSpy;
    const invocArgs = env.invocationArgs;
    beforeEach(function () {
      queryCmrSpy = sinon.spy(serviceRunner, 'runQueryCmrFromPull');
      serviceSpy = sinon.spy(serviceRunner, 'runPythonServiceFromPull');

      env.invocationArgs = 'abc\n123';
    });

    afterEach(function () {
      env.invocationArgs = invocArgs;
      queryCmrSpy.restore();
      serviceSpy.restore();
    });

    describe('when work is available', async function () {
      describe('and the work item contains a scroll ID', function () {
        const workItem = new WorkItem({
          jobID: '123',
          serviceID: 'abc',
          workflowStepIndex: 0,
          scrollID: 1234,
          operation: { requestID: 'foo' },
          id: 1,
        });
        it('calls runQueryCmrFromPull', async function () {
          await _doWork(workItem);
          expect(queryCmrSpy.called).to.be.true;
        });
      });

      describe('and the work item does not contain a scroll ID', function () {
        const workItem = new WorkItem({
          jobID: '123',
          serviceID: 'abc',
          workflowStepIndex: 0,
          operation: { requestID: 'foo' },
          id: 1,
        });
        it('calls runPythonServiceFromPull', async function () {
          await _doWork(workItem);
          expect(serviceSpy.called).to.be.true;
        });
      });
    });
  });
});
