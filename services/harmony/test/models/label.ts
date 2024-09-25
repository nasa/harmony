
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { buildJob, getFirstJob } from '../helpers/jobs';
import { hookTransactionEach } from '../helpers/db';
import { setLabelsForJob } from '../../app/models/label';

describe('label CRUD', function () {
  hookTransactionEach();
  beforeEach(async function () {
    this.job = await buildJob({ username: 'dummy' });
    this.job.save(this.trx);
  });

  const labels = ['foo', 'Bar'];

  describe('set labels for job', async function () {
    it('sets the labels for the job', async function () {
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, labels);
      const newJob = await getFirstJob(this.trx);
      expect(newJob.labels).deep.equal(labels.map((label) => label.toLowerCase()));
    });
  });

  describe('update labels for job', async function () {
    const updatedLabels = ['baz', 'buzz'];
    it('updates the labels for the job', async function () {
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, labels);
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, updatedLabels);
      const newJob = await getFirstJob(this.trx);
      expect(newJob.labels).deep.equal(updatedLabels.map((label) => label.toLowerCase()));
    });
  });

  describe('delete labels for job', async function () {
    it('deletes the labels for the job', async function () {
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, labels);
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, []);
      const newJob = await getFirstJob(this.trx);
      expect(newJob.labels).deep.equal([]);
    });
  });

  // retrieving job labels is tested implicitly in the other tests
});