import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as sinon from 'sinon';
import { SinonStub } from 'sinon';
import env from '../app/util/env';
import WorkItem from '../../../app/models/work-item';
import { hookGetWorkRequest } from './helpers/pull-worker';
import * as pullWorker from '../app/workers/pull-worker';
import PullWorker from '../app/workers/pull-worker';
import * as serviceRunner from '../app/service/service-runner';

const {
  _pullWork,
  _doWork,
  _pullAndDoWork,
  _primeCmrService,
  _primeService } = pullWorker.exportedForTesting;

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

  describe('on start with primer errors', async function () {
    let queryCMRStub: SinonStub;
    let exitStub: SinonStub;
    const { harmonyService } = env;

    beforeEach(async function () {
      exitStub = sinon.stub(process, 'exit');
      queryCMRStub = sinon.stub(pullWorker.exportedForTesting, '_primeCmrService').callsFake(
        async function () {
          throw new Error('primer failed');
        },
      );
      env.harmonyService = 'harmonyservices/query-cmr:latest';
    });

    afterEach(function () {
      exitStub.restore();
      queryCMRStub.restore();
      env.harmonyService = harmonyService;
    });

    it('tries two times then exits the program', async function () {
      const worker = new PullWorker();
      await worker.start(false);
      expect(exitStub.called).to.be.true;
      expect(queryCMRStub.callCount).to.equal(2);
    });
  });

  describe('pullWork', async function () {
    describe('when work is available', async function () {
      const workItem = new WorkItem({
        jobID: '123',
        serviceID: 'abc',
        workflowStepIndex: 1,
      });

      hookGetWorkRequest({ status: 200, workItem });

      it('returns a 200 status', async function () {
        const work = await _pullWork();
        expect(work.status).to.equal(200, 'Expected a 200 status when work is available');
      });

      it('returns a work item', async function () {
        const work = await _pullWork();
        expect(work.item).to.eql(workItem, 'Expected a work item');
      });
    });
    describe('when work is not available', async function () {
      hookGetWorkRequest({ status: 404 });

      it('returns a 404 status', async function () {
        const work = await _pullWork();
        expect(work.status).to.equal(404, 'Expected a 404 status when work is not available');
      });
    });
    describe('when there was an error getting work', async function () {
      hookGetWorkRequest({ status: 503, statusText: 'something bad happened' });
      it('returns an error message', async function () {
        const work = await _pullWork();
        expect(work.status).to.be.greaterThanOrEqual(400, 'Expected an error status');
        expect(work.error).to.eql('something bad happened');
      });
    });
  });

  describe('do work', async function () {
    let queryCmrSpy: sinon.SinonSpy;
    let serviceSpy: sinon.SinonSpy;
    const invocArgs = env.invocationArgs;
    beforeEach(function () {
      queryCmrSpy = sinon.spy(serviceRunner, 'runQueryCmrFromPull');
      serviceSpy = sinon.spy(serviceRunner, 'runServiceFromPull');

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
          workflowStepIndex: 1,
          operation: { requestID: 'foo' },
          id: 1,
        });
        it('calls runServiceFromPull', async function () {
          await _doWork(workItem);
          expect(serviceSpy.called).to.be.true;
        });
      });
    });
  });

  describe('_pullAndDoWork()', async function () {
    describe('when _pullWork throws an exception', async function () {
      let pullStub: SinonStub;
      let doWorkStub: SinonStub;
      const mock = new MockAdapter(axios);
      beforeEach(function () {
        pullStub = sinon.stub(pullWorker.exportedForTesting, '_pullWork').callsFake(async function () {
          throw new Error('something bad happened');
        });
        doWorkStub = sinon.stub(pullWorker.exportedForTesting, '_doWork').callsFake(async function (): Promise<WorkItem> {
          return new WorkItem({});
        });
        mock.onPut().reply(200, 'OK');
      });
      this.afterEach(function () {
        pullStub.restore();
        doWorkStub.restore();
        mock.restore();
      });

      it('does not throw', async function () {
        const call = (): Promise<void> => _pullAndDoWork(false);
        expect(call).to.not.throw();
      });
    });

    describe('when _doWork throws an exception', async function () {
      let pullStub: SinonStub;
      let doWorkStub: SinonStub;
      const mock = new MockAdapter(axios);
      beforeEach(function () {
        pullStub = sinon.stub(pullWorker.exportedForTesting, '_pullWork').callsFake(async function (): Promise<{ item?: WorkItem; status?: number; error?: string }> {
          return {};
        });
        doWorkStub = sinon.stub(pullWorker.exportedForTesting, '_doWork').callsFake(async function (): Promise<WorkItem> {
          throw new Error('something bad happened');
        });
        mock.onPut().reply(200, 'OK');
      });
      this.afterEach(function () {
        pullStub.restore();
        doWorkStub.restore();
        mock.restore();
      });

      it('does not throw', async function () {
        const call = (): Promise<void> => _pullAndDoWork(false);
        expect(call).to.not.throw();
      });
    });
  });

  describe('Service primers', async function () {
    let queryCmrSpy: sinon.SinonSpy;
    let serviceSpy: sinon.SinonSpy;
    const invocArgs = env.invocationArgs;
    beforeEach(function () {
      queryCmrSpy = sinon.spy(serviceRunner, 'runQueryCmrFromPull');
      serviceSpy = sinon.spy(serviceRunner, 'runServiceFromPull');

      env.invocationArgs = 'abc\n123';
    });

    afterEach(function () {
      env.invocationArgs = invocArgs;
      queryCmrSpy.restore();
      serviceSpy.restore();
    });

    describe('When the query-cmr service is primed', async function () {
      it('calls runQueryCmrFromPull', async function () {
        await _primeCmrService();
        expect(queryCmrSpy.called).to.be.true;
      });
    });

    describe('When a service is primed', async function () {
      it('calls runServiceFromPull', async function () {
        await _primeService();
        expect(serviceSpy.called).to.be.true;
      });
    });
  });
});
