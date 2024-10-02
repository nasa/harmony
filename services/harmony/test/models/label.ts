
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { buildJob, getFirstJob } from '../helpers/jobs';
import { hookTransactionEach } from '../helpers/db';
import { checkLabel, normalizeLabel, setLabelsForJob } from '../../app/models/label';

// unit tests for `checkLabel`
describe('checkLabel', function () {
  it('should return null for valid labels', function () {
    // Examples of valid labels
    const validLabels = [
      'latest',
      '1.0',
      'v1.😱.1',
      'version_1.2.3',
      'a'.repeat(255), // Maximum length
    ];

    validLabels.forEach(label => {
      const result = checkLabel(label);
      expect(result).to.be.null;
    });
  });

  it('should return an error message for invalid labels', function () {
    // Examples of invalid labels
    const invalidLabels = [
      'a'.repeat(256), // Exceeds maximum length
    ];

    const errorMessage = 'Labels may not exceed 255 characters in length.';

    invalidLabels.forEach(label => {
      const result = checkLabel(label);
      expect(result).to.equal(errorMessage);
    });
  });
});

// unit tests for `normalizeLabel`
describe('normalizeLabel', function () {
  it('should trim leading/trailing whitespace', function () {
    expect(normalizeLabel('    okay   ')).to.equal('okay');
  });

  it('should convert to lowercase', function () {
    expect(normalizeLabel('AbC')).to.equal('abc');
  });
});

describe('label CRUD', function () {
  hookTransactionEach();
  beforeEach(async function () {
    this.job = await buildJob({ username: 'dummy' });
    this.job.save(this.trx);
  });

  const labels = ['foo', 'bar'];

  describe('set labels for job', async function () {
    it('sets the labels for the job', async function () {
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, labels);
      const newJob = await getFirstJob(this.trx);
      expect(newJob.labels).deep.equal(labels);
    });
  });

  describe('update labels for job', async function () {
    const updatedLabels = ['baz', 'buzz'];
    it('updates the labels for the job', async function () {
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, labels);
      await setLabelsForJob(this.trx, this.job.jobID, this.job.username, updatedLabels);
      const newJob = await getFirstJob(this.trx);
      expect(newJob.labels).deep.equal(updatedLabels);
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