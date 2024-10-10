import { expect } from 'chai';
import { hookTransaction } from '../helpers/db';
import { buildJob, getFirstJob } from '../helpers/jobs';
import { addJobsLabels, deleteJobsLabels } from '../helpers/labels';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';

describe('Job label CRUD', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  const joeJob1 = buildJob({ username: 'joe' });
  before(async function () {
    await joeJob1.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  const { jobID } = joeJob1;
  const notFoundJobID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  describe('Set job labels', function () {
    describe('When the user created the job', function () {
      describe('When the jobs and labels are valid', function () {
        it('sets the normalized labels on the jobs', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['foo', '  Bar  '], 'joe');
          expect(response.status).to.equal(201);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar']);
        });
      });

      describe('When a job ID is not valid', function () {
        it('Returns an error for the job ID', async function () {
          const response = await addJobsLabels(this.frontend, ['bad-id'], ['foo', '  Bar  '], 'joe');
          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text).description).to.equal('Error: jobId bad-id is in invalid format.');
        });
      });

      describe('When a job does not exist', function () {
        it('Returns a not-found error', async function () {
          const response = await addJobsLabels(this.frontend, [jobID, notFoundJobID], ['foo'], 'joe');
          expect(response.status).to.equal(404);
          expect(JSON.parse(response.text).description).to.equal('Error: Unable to find job aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        });
      });

    });

    describe('When the user is an admin user that did not create the job', function () {
      describe('When the jobs and labels are valid', function () {
        it('sets the labels on the jobs', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['foo', '  Buzz  '], 'adam');
          expect(response.status).to.equal(201);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar', 'buzz']);
        });
      });
    });

    describe('When the user is not and admin user and did not create the job', function () {
      it('Pretends the job does not exist', async function () {
        const response = await addJobsLabels(this.frontend, [jobID], ['foo'], 'bob');
        expect(response.status).to.equal(404);
      });
    });
  });

  describe('Delete job labels', function () {
    beforeEach(async function () {
      await addJobsLabels(this.frontend, [jobID], ['label1', 'label2'], 'joe');
    });

    describe('When the user created the jobs', function () {
      describe('When the jobs and labels are valid', function () {
        it('deletes the labels from the jobs', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID], ['label1'], 'joe');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar', 'buzz', 'label2']);
        });
      });

      describe('When some of the labels are not on the jobs', function () {
        it('ignores the labels that are not on the jobs', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID], ['label1', 'missing-label'], 'joe');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar', 'buzz', 'label2']);
        });
      });

      describe('When a job ID is not valid', function () {
        it('Returns an error for the job ID', async function () {
          const response = await deleteJobsLabels(this.frontend, ['bad-id'], ['label1'], 'joe');
          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text).description).to.equal('Error: jobId bad-id is in invalid format.');
        });
      });

      describe('When a job does not exist', function () {
        it('Returns a not-found error', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID, notFoundJobID], ['foo'], 'joe');
          expect(response.status).to.equal(404);
          expect(JSON.parse(response.text).description).to.equal('Error: Unable to find job aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        });
      });

    });

    describe('When the user is an admin user that did not create the job', function () {
      describe('When the jobs and labels are valid', function () {
        it('deletes the labels from the jobs', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID], ['label2', 'buzz'], 'adam');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar', 'label1']);
        });
      });
    });

    describe('When the user is not and admin user and did not create the job', function () {
      it('Pretends the job does not exist', async function () {
        const response = await deleteJobsLabels(this.frontend, [jobID], ['label1'], 'bob');
        expect(response.status).to.equal(404);
      });
    });
  });
});