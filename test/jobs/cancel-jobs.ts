import { JobRecord, JobStatus, Job } from 'harmony/models/job';
import { v4 as uuid } from 'uuid';
import hookServersStartStop from 'harmony-test/servers';
import { hookTransaction } from 'harmony-test/db';
import { jobsEqual, cancelJob, hookCancelJob } from 'harmony-test/jobs';
import { expect } from 'chai';
import _ from 'lodash';
import { hookRedirect } from 'harmony-test/hooks';

const aJob: JobRecord = {
  username: 'joe',
  requestId: uuid().toString(),
  status: JobStatus.RUNNING,
  message: 'it is running',
  progress: 42,
  links: [
    {
      href: 'http://example.com',
      rel: 'link',
      type: 'text/plain',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    }],
  request: 'http://example.com/harmony?job=aJob',
};

describe('Canceling a job', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookTransaction();
  before(async function () {
    await new Job(aJob).save(this.trx);
    this.trx.commit();
  });
  const jobID = aJob.requestId;
  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await cancelJob(this.frontend, { jobID }).redirects(0);
    });
    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/cancel`));
    });
  });

  describe('For a logged-in user who owns the job', function () {
    hookCancelJob({ jobID, username: 'joe' });
    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
    });
    describe('When following the redirect to the canceled job', function () {
      hookRedirect('joe');
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a single job record in JSON format', function () {
        const actualJob = JSON.parse(this.res.text);
        const expectedJobKeys = [
          'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links', 'request', 'jobID',
        ];
        expect(Object.keys(actualJob)).to.eql(expectedJobKeys);
      });

      it('changes the status to canceled', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.status).to.eql('canceled');
      });
      it('sets the message to canceled by user', function () {
        const actualJob = JSON.parse(this.res.text);
        expect(actualJob.status).to.eql('canceled');
      });
      it('does not modify any of the other job fields', function () {
        const actualJob: Job = JSON.parse(this.res.text);
        const expectedJob: JobRecord = _.cloneDeep(aJob);
        expectedJob.message = 'foo';
        actualJob.message = 'foo';
        actualJob.status = JobStatus.CANCELED;
        expectedJob.status = JobStatus.CANCELED;
        expect(jobsEqual(expectedJob, actualJob)).to.be.true;
      });
    });
  });

  describe('For a logged-in user who does not own the job', function () {
    hookCancelJob({ jobID, username: 'jill' });
    it('returns a 404 HTTP Not found response', function () {
      expect(this.res.statusCode).to.equal(404);
    });

    it('returns a JSON error response', function () {
      const response = JSON.parse(this.res.text);
      expect(response).to.eql({
        code: 'harmony.NotFoundError',
        description: `Error: Unable to find job ${jobID}` });
    });
  });
});
