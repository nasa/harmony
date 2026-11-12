import { expect } from 'chai';
import request from 'supertest';

import { Job } from '../../app/models/job';
import db from '../../app/util/db';
import { auth } from '../helpers/auth';
import { buildJob } from '../helpers/jobs';
import hookServersStartStop from '../helpers/servers';

/**
 * Returns the labels for the given job
 *
 * @param jobID - The job ID
 * @returns The job's labels
 */
async function labelsForJob(jobID: string): Promise<string[]> {
  return (await Job.byJobID(db, jobID, false, true, false)).job.labels;
}

// Requests are sent as raw URLs so that literal and URL-encoded commas are sent exactly as given.
// harmony-py sends labels for these routes as query parameters, e.g., label=a%2Cb for ['a,b'].
describe('Labels containing commas on the labels and jobs routes', function () {
  hookServersStartStop({ USE_EDL_CLIENT_APP: true });

  describe('when adding labels with PUT /labels', function () {
    const tests = [{
      description: 'a single query parameter with a URL-encoded comma',
      makeRequest: (app, jobID: string): request.Test => request(app).put(`/labels?jobID=${jobID}&label=a%2Cb`),
      expectedLabels: ['a,b'],
    }, {
      description: 'a single query parameter with a literal comma',
      makeRequest: (app, jobID: string): request.Test => request(app).put(`/labels?jobID=${jobID}&label=a,b`),
      expectedLabels: ['a', 'b'],
    }, {
      description: 'repeated query parameters, one with a URL-encoded comma',
      makeRequest: (app, jobID: string): request.Test => request(app).put(`/labels?jobID=${jobID}&label=a%2Cb&label=c`),
      expectedLabels: ['a,b', 'c'],
    }, {
      description: 'a JSON body with a comma-separated string',
      makeRequest: (app, jobID: string): request.Test => request(app).put('/labels').send({ jobID: [jobID], label: 'a,b' }),
      expectedLabels: ['a', 'b'],
    }, {
      description: 'a JSON body with an array value containing a comma',
      makeRequest: (app, jobID: string): request.Test => request(app).put('/labels').send({ jobID: [jobID], label: ['a,b', 'c'] }),
      expectedLabels: ['a,b', 'c'],
    }];

    for (const { description, makeRequest, expectedLabels } of tests) {
      describe(`using ${description}`, function () {
        const job = buildJob({ username: 'joe' });
        before(async function () {
          await job.save(db);
          this.res = await makeRequest(this.frontend, job.jobID).use(auth({ username: 'joe' }));
        });
        after(function () {
          delete this.res;
        });

        it('returns an HTTP success response', function () {
          expect(this.res.status).to.equal(201);
        });

        it('adds the expected labels to the job', async function () {
          expect(await labelsForJob(job.jobID)).to.have.members(expectedLabels);
          expect((await labelsForJob(job.jobID)).length).to.equal(expectedLabels.length);
        });
      });
    }
  });

  describe('when deleting a label containing a comma with DELETE /labels using a URL-encoded comma', function () {
    const job = buildJob({ username: 'joe' });
    before(async function () {
      await job.save(db);
      await request(this.frontend).put(`/labels?jobID=${job.jobID}&label=a%2Cb&label=c`).use(auth({ username: 'joe' }));
      this.res = await request(this.frontend).delete(`/labels?jobID=${job.jobID}&label=a%2Cb`).use(auth({ username: 'joe' }));
    });
    after(function () {
      delete this.res;
    });

    it('removes only that label', async function () {
      expect(this.res.status).to.equal(204);
      expect(await labelsForJob(job.jobID)).to.eql(['c']);
    });
  });

  describe('when listing jobs by a label containing a comma', function () {
    const job = buildJob({ username: 'joe' });
    before(async function () {
      await job.save(db);
      await request(this.frontend).put('/labels').send({ jobID: [job.jobID], label: ['commas,in,label'] }).use(auth({ username: 'joe' }));
    });

    describe('using a single query parameter with URL-encoded commas', function () {
      before(async function () {
        this.res = await request(this.frontend).get('/jobs?label=commas%2Cin%2Clabel').use(auth({ username: 'joe' }));
      });
      after(function () {
        delete this.res;
      });

      it('returns the job with that label', function () {
        const listing = JSON.parse(this.res.text);
        expect(listing.jobs.map((j) => j.jobID)).to.eql([job.jobID]);
      });
    });

    describe('using a single query parameter with literal commas', function () {
      before(async function () {
        this.res = await request(this.frontend).get('/jobs?label=commas,in,label').use(auth({ username: 'joe' }));
      });
      after(function () {
        delete this.res;
      });

      it('treats each comma-separated value as a separate label and does not return the job', function () {
        const listing = JSON.parse(this.res.text);
        expect(listing.jobs.map((j) => j.jobID)).to.not.include(job.jobID);
      });
    });
  });
});
