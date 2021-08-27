/* eslint-disable no-loop-func */
import { expect } from 'chai';
import _ from 'lodash';
import { Transaction } from 'knex';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { buildJob } from '../helpers/jobs';

/**
 * Queries the database for the number of jobs in the jobs table.
 *
 * @param trx - The database transaction.
 * @returns The number of jobs in the database.
 */
async function countJobs(trx: Transaction): Promise<number> {
  const result = await trx('jobs').count('*');
  return Number(result[0]['count(*)']);
}

describe('Attaching a job', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  const joeJob1 = buildJob({ username: 'joe' });

  describe('for a single job', function () {
    it('should not attach', async function () {
      // this is called before a job is saved to the database
      await joeJob1.maybeAttach(this.trx);
      expect(joeJob1.attachedStatus.didAttach).to.equal(false);
    });
  });

  describe('for multiple jobs', function () {
    before(async function () {
      await joeJob1.save(this.trx);
    });

    it('a second job, same as the first, from the same user should attach', async function () {
      const joeJob2 = buildJob({ username: 'joe' });
      const originalId = joeJob2.requestId;
      await joeJob2.maybeAttach(this.trx);
      expect(joeJob2.attachedStatus.didAttach).to.equal(true);
      expect(joeJob2.attachedStatus.originalId).to.equal(originalId);
      expect(joeJob2.attachedStatus.assumedId).to.equal(joeJob1.requestId);
    });

    it('a second job, same as the first, from a different user should not attach', async function () {
      const janeJob = buildJob({ username: 'jane' });
      await janeJob.maybeAttach(this.trx);
      expect(janeJob.attachedStatus.didAttach).to.equal(false);
    });

    it('a second job, different from the first, from the same user should not attach', async function () {
      const joeJob2 = buildJob({ username: 'joe', request: 'http://example.com/harmony?baz=qux' });
      await joeJob2.maybeAttach(this.trx);
      expect(joeJob2.attachedStatus.didAttach).to.equal(false);
    });

    it('a job that attaches should not save to the database', async function () {
      const expectedJobCount = await countJobs(this.trx);
      const joeJob2 = buildJob({ username: 'joe' });
      await joeJob2.maybeAttach(this.trx);
      await joeJob2.save(this.trx);
      const actualJobCount = await countJobs(this.trx);
      expect(actualJobCount).to.equal(expectedJobCount);
    });
  });
});
