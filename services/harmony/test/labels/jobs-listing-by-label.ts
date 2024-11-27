import { expect } from 'chai';
import { buildJob, hookAdminJobListing, hookJobListing } from '../helpers/jobs';
import { addJobsLabels } from '../helpers/labels';
import hookServersStartStop from '../helpers/servers';
import db from '../../app/util/db';

describe('Get jobs listing by label', function () {
  hookServersStartStop({ SKIP_EARTHDATA_LOGIN: false });
  const joeJob1 = buildJob({ username: 'joe' });
  const joeJob2 = buildJob({ username: 'joe' });
  const jillJob1 = buildJob({ username: 'jill' });
  const allJobLabels = ['cat', 'dog', 'frog'];
  const joe1AndJill1Labels = ['apple', 'banana'];
  const joe1AndJoe2Labels = ['taco'];

  const joeJob1Labels = new Set(['cat', 'dog', 'frog', 'apple', 'banana', 'taco', 'joe1-unique']);
  const joeJob2Labels = new Set(['cat', 'dog', 'frog', 'taco', 'joe2-unique']);
  const jillJob1Labels = new Set(['cat', 'dog', 'frog', 'apple', 'banana', 'jill1-unique']);

  before(async function () {
    await jillJob1.save(db);
    await joeJob2.save(db);
    await joeJob1.save(db);
    await addJobsLabels(this.frontend, [joeJob1.jobID, joeJob2.jobID], allJobLabels, 'joe');
    await addJobsLabels(this.frontend, [jillJob1.jobID], allJobLabels, 'jill');
    await addJobsLabels(this.frontend, [joeJob1.jobID, joeJob2.jobID], joe1AndJoe2Labels, 'joe');
    await addJobsLabels(this.frontend, [joeJob1.jobID], joe1AndJill1Labels, 'joe');
    await addJobsLabels(this.frontend, [jillJob1.jobID], joe1AndJill1Labels, 'jill');
    await addJobsLabels(this.frontend, [joeJob1.jobID], ['joe1-unique'], 'joe');
    await addJobsLabels(this.frontend, [joeJob2.jobID], ['joe2-unique'], 'joe');
    await addJobsLabels(this.frontend, [jillJob1.jobID], ['jill1-unique'], 'jill');
  });

  describe('Searching for a single label matching a job for one user', function () {
    hookJobListing({ username: 'joe', label: 'joe1-unique' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns only the expected job', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(1);
      expect(listing.jobs[0].jobID).to.equal(joeJob1.jobID);
    });

    it('returns the full set of labels in the matched job', function () {
      const listing = JSON.parse(this.res.text);
      expect(new Set(listing.jobs[0].labels)).to.eql(joeJob1Labels);
    });
  });

  describe('Searching for a single label that matches two jobs for different users', function () {
    describe('Searching as Joe', function () {
      hookJobListing({ username: 'joe', label: 'apple' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns only Joe\'s job', function () {
        const listing = JSON.parse(this.res.text);
        expect(listing.count).to.equal(1);
        expect(listing.jobs[0].jobID).to.equal(joeJob1.jobID);
      });

      it('returns the full set of labels in the matched job', function () {
        const listing = JSON.parse(this.res.text);
        expect(new Set(listing.jobs[0].labels)).to.eql(joeJob1Labels);
      });
    });

    describe('Searching as Jill', function () {
      hookJobListing({ username: 'jill', label: 'apple' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns only Jill\'s job', function () {
        const listing = JSON.parse(this.res.text);
        expect(listing.count).to.equal(1);
        expect(listing.jobs[0].jobID).to.equal(jillJob1.jobID);
      });

      it('returns the full set of labels in the matched job', function () {
        const listing = JSON.parse(this.res.text);
        expect(new Set(listing.jobs[0].labels)).to.eql(jillJob1Labels);
      });
    });

    describe('Searching as an admin on the admin route', function () {
      hookAdminJobListing({ username: 'adam', label: 'apple' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns both jobs', function () {
        const listing = JSON.parse(this.res.text);
        expect(listing.count).to.equal(2);
        expect(listing.jobs[0].jobID).to.equal(joeJob1.jobID);
        expect(listing.jobs[1].jobID).to.equal(jillJob1.jobID);
      });

      it('returns the full set of labels in the matched jobs', function () {
        const listing = JSON.parse(this.res.text);
        expect(new Set(listing.jobs[0].labels)).to.eql(joeJob1Labels);
        expect(new Set(listing.jobs[1].labels)).to.eql(jillJob1Labels);
      });
    });
  });

  describe('Searching for a single label that matches two jobs for one user', function () {
    hookJobListing({ username: 'joe', label: 'taco' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns both jobs for the user', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(2);
      expect(listing.jobs[0].jobID).to.equal(joeJob1.jobID);
      expect(listing.jobs[1].jobID).to.equal(joeJob2.jobID);
    });

    it('returns the full set of labels in the matched jobs', function () {
      const listing = JSON.parse(this.res.text);
      expect(new Set(listing.jobs[0].labels)).to.eql(joeJob1Labels);
      expect(new Set(listing.jobs[1].labels)).to.eql(joeJob2Labels);
    });
  });

  describe('Searching for a single label that does not exist', function () {
    hookJobListing({ username: 'joe', label: 'missing' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns no jobs', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(0);
    });
  });

  describe('Searching for a single label that exists for a different user', function () {
    hookJobListing({ username: 'jill', label: 'joe1-unique' });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns no jobs', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(0);
    });
  });

  describe('Searching for multiple labels where one matches for that user and the other does not', function () {
    hookJobListing({ username: 'joe', label: ['joe2-unique', 'jill1-unique'] });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns only the expected job', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(1);
      expect(listing.jobs[0].jobID).to.equal(joeJob2.jobID);
    });

    it('returns the full set of labels in the matched job', function () {
      const listing = JSON.parse(this.res.text);
      expect(new Set(listing.jobs[0].labels)).to.eql(joeJob2Labels);
    });
  });

  describe('Searching for multiple labels where both labels match different jobs for the same user', function () {
    hookJobListing({ username: 'joe', label: ['joe1-unique', 'joe2-unique'] });
    it('returns an HTTP success response', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns both jobs for the user', function () {
      const listing = JSON.parse(this.res.text);
      expect(listing.count).to.equal(2);
      expect(listing.jobs[0].jobID).to.equal(joeJob1.jobID);
      expect(listing.jobs[1].jobID).to.equal(joeJob2.jobID);
    });

    it('returns the full set of labels in the matched jobs', function () {
      const listing = JSON.parse(this.res.text);
      expect(new Set(listing.jobs[0].labels)).to.eql(joeJob1Labels);
      expect(new Set(listing.jobs[1].labels)).to.eql(joeJob2Labels);
    });
  });

});