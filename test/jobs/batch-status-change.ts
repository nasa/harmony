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
import { JobStatus, Job } from '../../app/models/job';


describe('jobs/cancel, jobs/resume, jobs/skip-preview, jobs/resume)', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('Canceling multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe' });
    const joeJob2 = buildJob({ username: 'joe' });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookCancelJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Cancels the jobs', function () {
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('Pausing multiple jobs', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe' });
    const joeJob2 = buildJob({ username: 'joe' });
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    hookPauseJobs({ username: 'joe', 'jobIDs': [joeJob1.jobID, joeJob2.jobID] });

    it('Pauses the jobs', function () {
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

    it('Resumes the jobs', function () {
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

    it('Skips the job previews', function () {
      expect(this.res.statusCode).to.equal(200);
    });
  });
});
