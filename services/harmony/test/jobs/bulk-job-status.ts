import { expect } from 'chai';
import { v4 as uuid } from 'uuid';

import { hookTransaction } from '../../../../packages/util/test/helpers/db';
import { JobStatus } from '../../app/models/job';
import env from '../../app/util/env';
import {
  adminUsername, buildJob, hookBulkJobStatus,
} from '../helpers/jobs';
import hookServersStartStop from '../helpers/servers';

describe('POST /jobs/status', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('when the request is well formed', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe', status: JobStatus.RUNNING, progress: 42 });
    const joeJob2 = buildJob({ username: 'joe', status: JobStatus.SUCCESSFUL, progress: 100 });
    const bobJob1 = buildJob({ username: 'bob', status: JobStatus.FAILED, progress: 13 });
    const missingJobID = uuid();
    before(async function () {
      await joeJob1.save(this.trx);
      await joeJob2.save(this.trx);
      await bobJob1.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });

    describe('as the owning user', function () {
      hookBulkJobStatus({
        username: 'joe',
        jobIDs: [joeJob1.jobID, joeJob2.jobID, bobJob1.jobID, missingJobID],
      });

      it('returns a 200', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns only jobID, status, and progress for jobs the user owns', function () {
        const body = JSON.parse(this.res.text);
        expect(body.jobStatuses).to.have.deep.members([
          { jobID: joeJob1.jobID, status: JobStatus.RUNNING, progress: 42 },
          { jobID: joeJob2.jobID, status: JobStatus.SUCCESSFUL, progress: 100 },
        ]);
      });

      it('masks a job owned by another user as not found, alongside a genuinely missing job ID', function () {
        const body = JSON.parse(this.res.text);
        expect(body.notFoundJobIDs).to.have.members([bobJob1.jobID, missingJobID]);
      });
    });

    describe('as an admin', function () {
      hookBulkJobStatus({ username: adminUsername, jobIDs: [joeJob1.jobID, bobJob1.jobID, missingJobID] });

      it('returns a 200', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns jobs across all users', function () {
        const body = JSON.parse(this.res.text);
        expect(body.jobStatuses).to.have.deep.members([
          { jobID: joeJob1.jobID, status: JobStatus.RUNNING, progress: 42 },
          { jobID: bobJob1.jobID, status: JobStatus.FAILED, progress: 13 },
        ]);
      });

      it('only reports the genuinely missing job ID as not found', function () {
        const body = JSON.parse(this.res.text);
        expect(body.notFoundJobIDs).to.eql([missingJobID]);
      });
    });
  });

  describe('validation', function () {
    hookTransaction();

    describe('when jobIDs is missing from the request body', function () {
      hookBulkJobStatus({ username: 'joe', jobIDs: undefined });

      it('returns a 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a validation error', function () {
        const body = JSON.parse(this.res.text);
        expect(body.code).to.equal('harmony.RequestValidationError');
      });
    });

    describe('when jobIDs is empty', function () {
      hookBulkJobStatus({ username: 'joe', jobIDs: [] });

      it('returns a 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });
    });

    describe('when a jobID is not a valid UUID', function () {
      hookBulkJobStatus({ username: 'joe', jobIDs: [uuid(), 'not-a-uuid'] });

      it('returns a 400 and rejects the whole batch', function () {
        expect(this.res.statusCode).to.equal(400);
        const body = JSON.parse(this.res.text);
        expect(body.jobStatuses).to.be.undefined;
      });
    });

    describe('when there are more jobIDs than the configured maximum', function () {
      const tooMany = Array.from({ length: env.maxBulkJobStatusIds + 1 }, () => uuid());
      hookBulkJobStatus({ username: 'joe', jobIDs: tooMany });

      it('returns a 400', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('describes the configured maximum in the error message', function () {
        const body = JSON.parse(this.res.text);
        expect(body.description).to.contain(`${env.maxBulkJobStatusIds}`);
      });
    });
  });
});
