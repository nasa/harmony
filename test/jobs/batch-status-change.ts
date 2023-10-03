/* eslint-disable no-loop-func */
import { expect } from 'chai';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import {
  buildJob,
  hookCancelJobs,
  hookPauseJobs,
  hookResumeJobs,
  hookSkipPreviewJobs,
} from '../helpers/jobs';
import db from '../../app/util/db';
import { JobStatus, Job } from '../../app/models/job';


describe('jobs/cancel, jobs/resume, jobs/skip-preview, jobs/resume', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('Canceling multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.RUNNING });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.PAUSED });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Cancels the jobs', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.CANCELED);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.CANCELED);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('Pausing multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.RUNNING });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.RUNNING_WITH_ERRORS });
    const joeJob3 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      await joeJob3.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookPauseJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID, joeJob3.jobID] });

    it('Pauses the jobs', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.PAUSED);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.PAUSED);
      const dbJob3 = await Job.byJobID(db, joeJob3.jobID);
      expect(dbJob3.status).to.eq(JobStatus.PAUSED);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('Resuming multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.PAUSED });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.PAUSED });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookResumeJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Resumes the jobs', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.RUNNING);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.RUNNING);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('Skipping preview for multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookSkipPreviewJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Skips the job previews', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.RUNNING);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.RUNNING);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('Skipping preview for multiple jobs and only one is previewing', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.CANCELED });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookSkipPreviewJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Skips the job preview for only one job', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.RUNNING);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.CANCELED);
      expect(JSON.parse(this.res.error.text).description).to.equal('Error: Could not change all job statuses. Proccessed 1.');
    });
  });

  describe('An admin changing the status for jobs owned by other users', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    const buzzJob1 = buildJob({ username: 'buzz', status: JobStatus.PREVIEWING });
    before(async function () {
      await joeJob1.save(this.trx);
      await buzzJob1.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookSkipPreviewJobs({ username: 'adam', 'jobIDs': [joeJob1.jobID, buzzJob1.jobID] });

    it('Skips the job previews', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.RUNNING);
      const dbJob2 = await Job.byJobID(db, buzzJob1.jobID);
      expect(dbJob2.status).to.eq(JobStatus.RUNNING);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('An non-admin changing the status for jobs owned by another user', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.PREVIEWING });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookSkipPreviewJobs({ username: 'woody', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Does not skip the job previews (returns an error)', async function () {
      const dbJob1 = await Job.byJobID(db, joeJob1.jobID);
      expect(dbJob1.status).to.eq(JobStatus.PREVIEWING);
      const dbJob2 = await Job.byJobID(db, joeJob2.jobID);
      expect(dbJob2.status).to.eq(JobStatus.PREVIEWING);
      expect(JSON.parse(this.res.error.text).description).to.equal('Error: Could not change all job statuses. Proccessed 0.');
    });
  });
});
