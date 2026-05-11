import { expect } from 'chai';
import * as sinon from 'sinon';

import * as workItemsStatsModel from '../../harmony/app/models/work-items-stats';
import { WorkItemsStatsCron } from '../app/cronjobs/update-work-items-stats';

describe('WorkItemsStatsCron', function () {
  let sandbox: sinon.SinonSandbox;
  let mockLogger: {
    info: sinon.SinonStub;
    error: sinon.SinonStub;
  };
  let mockTx: sinon.SinonStub;
  let mockDb: { transaction: sinon.SinonStub };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  let upsertStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    mockLogger = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    mockTx = sandbox.stub();
    mockDb = {
      transaction: sandbox.stub().callsFake(async (fn) => fn(mockTx)),
    };

    ctx = { logger: mockLogger, db: mockDb };

    upsertStub = sandbox.stub(workItemsStatsModel, 'upsertWorkItemStats');
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('run', function () {
    it('logs start and completion on success', async function () {
      upsertStub.resolves(5);

      await WorkItemsStatsCron.run(ctx);

      expect(mockLogger.info.calledWith('Started work items stats cron job')).to.be.true;
      expect(mockLogger.info.calledWith('Completed work items stats cron job')).to.be.true;
    });

    it('calls upsertWorkItemStats within a transaction', async function () {
      upsertStub.resolves(3);

      await WorkItemsStatsCron.run(ctx);

      expect(mockDb.transaction.calledOnce).to.be.true;
      expect(upsertStub.calledOnce).to.be.true;
      expect(upsertStub.calledWith(mockTx)).to.be.true;
    });

    it('logs the number of rows inserted or updated', async function () {
      upsertStub.resolves(7);

      await WorkItemsStatsCron.run(ctx);

      expect(
        mockLogger.info.calledWith('Work items stats updater inserted or updated 7 rows'),
      ).to.be.true;
    });

    it('logs zero rows when upsert returns 0', async function () {
      upsertStub.resolves(0);

      await WorkItemsStatsCron.run(ctx);

      expect(
        mockLogger.info.calledWith('Work items stats updater inserted or updated 0 rows'),
      ).to.be.true;
    });

    it('logs an error and does not throw when upsertWorkItemStats throws', async function () {
      const err = new Error('DB failure');
      upsertStub.rejects(err);

      await expect(WorkItemsStatsCron.run(ctx)).to.not.be.rejected;

      expect(mockLogger.error.calledWith('Failed to update work items stats')).to.be.true;
      expect(mockLogger.error.calledWith(err)).to.be.true;
    });

    it('logs an error and does not throw when db.transaction throws', async function () {
      const err = new Error('Transaction failure');
      mockDb.transaction.rejects(err);

      await expect(WorkItemsStatsCron.run(ctx)).to.not.be.rejected;

      expect(mockLogger.error.calledWith('Failed to update work items stats')).to.be.true;
      expect(mockLogger.error.calledWith(err)).to.be.true;
    });

    it('does not log completion when an error occurs', async function () {
      upsertStub.rejects(new Error('fail'));

      await WorkItemsStatsCron.run(ctx);

      expect(mockLogger.info.calledWith('Completed work items stats cron job')).to.be.false;
    });
  });
});
