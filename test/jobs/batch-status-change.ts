/* eslint-disable no-loop-func */
import { expect } from 'chai';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import {
  cancelJob,
  buildJob,
} from '../helpers/jobs';
import { hookRedirect } from '../helpers/hooks';
import { JobStatus, Job } from '../../app/models/job';


describe('Cancel batch of jobs', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('For a logged-in user who owns the job', function () {
    hookTransaction();
    const joeJob1 = buildJob({ username: 'joe' });
    before(async function () {
      await joeJob1.save(this.trx);
      this.trx.commit();
      this.trx = null;
    });
    const { jobID } = joeJob1;
    cancelEndpointHook({ jobID, username: 'joe' });

    it('returns a redirect to the canceled job', function () {
      expect(this.res.statusCode).to.equal(302);
      expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
    });
  });
});
