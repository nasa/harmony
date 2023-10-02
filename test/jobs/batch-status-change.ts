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
import { hookRedirect } from 'test/helpers/hooks';


describe('Cancel batch of jobs', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('For a logged-in user who owns the job', function () {
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

    it('returns a redirect to the canceled job', function () {
      console.log(this.res);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('For a logged-in user who owns the job', function () {
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

    it('returns a redirect to the canceled job', function () {
      console.log(this.res);
      expect(this.res.statusCode).to.equal(200);
    });
  });

  describe('For a logged-in user who owns the job', function () {
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

    it('returns a redirect to the canceled job', function () {
      console.log(this.res);
      expect(this.res.statusCode).to.equal(302);
    });
  });

  describe('For a logged-in user who owns the job', function () {
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

    it('returns a redirect to the canceled job', function () {
      console.log(this.res);
      expect(this.res.statusCode).to.equal(302);
    });
  });
});
