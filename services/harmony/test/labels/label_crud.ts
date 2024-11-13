import { expect } from 'chai';
import { profanity } from '@2toad/profanity';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob, getFirstJob } from '../helpers/jobs';
import { addJobsLabels, deleteJobsLabels } from '../helpers/labels';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';
import env from '../../app/util/env';
import { stub } from 'sinon';
import { getLabelsForUser } from '../../app/models/label';

describe('Get Labels', function () {
  const joeJob = buildJob({ username: 'joe' });
  const jillJob = buildJob({ username: 'jill' });
  hookServersStartStop({ skipEarthdataLogin: false });
  before(async function () {
    await truncateAll();
    const trx = await db.transaction();
    await joeJob.save(trx);
    await jillJob.save(trx);
    await trx.commit();
  });

  describe('When getting labels using the admin route', function () {
    describe('When multiple users use the same label', function () {
      it('the label only appears once in the returned list', async function () {
        await addJobsLabels(this.frontend, [joeJob.jobID], ['foo', 'bar'], 'joe');
        await addJobsLabels(this.frontend, [jillJob.jobID], ['foo', 'boo'], 'jill');
        // get up to ten labels across all users
        const labels = await getLabelsForUser(
          db,
          'adam',
          10,
          true,
        );
        expect(labels).deep.equal(['foo', 'boo', 'bar']);
      });
    });
  });
});

describe('Job label CRUD', function () {
  const envLabelsAllowListStub = stub(env, 'labelsAllowList').get(() => 'butt');
  const envLabelsForbidListStub = stub(env, 'labelsForbidList').get(() => 'buzz');
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  const joeJob1 = buildJob({ username: 'joe' });
  before(async function () {
    await joeJob1.save(this.trx);
    this.trx.commit();
    this.trx = null;
  });

  after(function () {
    envLabelsAllowListStub.restore();
    envLabelsForbidListStub.restore();
    profanity.whitelist.removeWords(['butt']);
    profanity.removeWords(['buzz']);
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
          expect(savedJob.labels).deep.equal(['bar', 'foo']);
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

      describe('When a label is a forbidden', function () {
        it('Returns an error for the label', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['foo', 'buzz'], 'joe');
          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text).description).to.equal('Error: b*zz is not an allowed label');
        });
      });

      describe('When a label is on the allowed list', function () {
        it('Returns an error for the label', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['butt'], 'joe');
          expect(response.status).to.equal(201);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['bar', 'butt', 'foo']);
        });
      });

    });

    describe('When the user is an admin user that did not create the job', function () {
      describe('When the jobs and labels are valid', function () {
        xit('sets the labels on the jobs', async function () {
          const response = await addJobsLabels(this.frontend, [jobID], ['foo', '  Buzz  '], 'adam');
          expect(response.status).to.equal(201);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['bar', 'buzz', 'foo']);
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
          const response = await deleteJobsLabels(this.frontend, [jobID], ['butt', 'label1'], 'joe');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          // TODO uncomment this line and remove the following when admin access to labels is enabled
          // expect(savedJob.labels).deep.equal(['bar', 'buzz', 'foo', 'label2']);
          expect(savedJob.labels).deep.equal(['bar', 'foo', 'label2']);
        });
      });

      describe('When some of the labels are not on the jobs', function () {
        it('ignores the labels that are not on the jobs', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID], ['label1', 'missing-label'], 'joe');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          // TODO uncomment this line and remove the following when admin access to labels is enabled
          // expect(savedJob.labels).deep.equal(['bar', 'buzz', 'foo', 'label2']);
          expect(savedJob.labels).deep.equal(['bar', 'foo', 'label2']);
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
        xit('deletes the labels from the jobs', async function () {
          const response = await deleteJobsLabels(this.frontend, [jobID], ['label2', 'buzz'], 'adam');
          expect(response.status).to.equal(204);
          const savedJob = await getFirstJob(db, { where: { jobID } });
          expect(savedJob.labels).deep.equal(['bar', 'foo', 'label1']);
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