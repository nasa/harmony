import { expect } from 'chai';
import { hookTransaction } from '../helpers/db';
import { buildJob, getFirstJob } from '../helpers/jobs';
import { addJobsLabels } from '../helpers/labels';
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

      describe('When a job does not exit', function () {
        it('Returns a not-found error error', async function () {
          const response = await addJobsLabels(this.frontend, [jobID, notFoundJobID], ['foo'], 'joe');
          expect(response.status).to.equal(404);
          expect(JSON.parse(response.text).description).to.equal('Error: Unable to find job aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        });
      });

    });

    describe('When the user is an admin user that did not create the job', function () {
      describe('When the jobs and labels are valid', function () {
        it('sets the labels on the jobs', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['foo', '  Bar  '], 'adam');
          expect(response.status).to.equal(201);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['foo', 'bar']);
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
});