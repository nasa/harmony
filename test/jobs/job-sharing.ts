import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookStacCatalog, hookStacItem } from '../helpers/stac';
import { hookTransaction } from '../helpers/db';
import { hookJobStatus, buildJob } from '../helpers/jobs';

const jobOwner = 'joe';
const notJobOwner = 'jill'; // jill wants to access the results of joe's jobs

const collectionWithEULAFalseAndGuestReadTrue = 'C1233800302-EEDTEST';
const collectionWithEULATrueAndGuestsReadTrue = 'C1233860183-EEDTEST';
const collectionWithEULAFalseAndGuestReadFalse = 'C1233147317-EEDTEST';
const collectionWithEULANonexistent = 'C1234088182-EEDTEST';

const baseJobProperties = {
  numInputGranules: 5,
  links: [{
    href: 's3://example-bucket/public/example/path1.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2020-01-01T00:00:00.000Z'),
      end: new Date('2020-01-01T01:00:00.000Z'),
    },
  },
  {
    href: 's3://example-bucket/public/example/path2.tif',
    type: 'image/tiff',
    rel: 'data',
    bbox: [-10, -10, 10, 10],
    temporal: {
      start: new Date('2021-01-01T00:00:00.000Z'),
      end: new Date('2021-01-01T01:00:00.000Z'),
    },
  }],
  request: 'http://example.com/harmony?job=completedJob',
  status: JobStatus.SUCCESSFUL,
};

const jobWithNoCollections = buildJob({
  username: jobOwner,
  collectionIds: [],
  ...baseJobProperties,
});
const jobIDWithNoCollections = jobWithNoCollections.requestId;

const jobWithEULAFalseAndGuestReadTrue = buildJob({
  username: jobOwner,
  collectionIds: [collectionWithEULAFalseAndGuestReadTrue],
  ...baseJobProperties,
});
const jobIDWithEULAFalseAndGuestReadTrue = jobWithEULAFalseAndGuestReadTrue.requestId;

const jobWithEULATrueAndGuestReadTrue = buildJob({
  username: jobOwner,
  collectionIds: [collectionWithEULATrueAndGuestsReadTrue],
  ...baseJobProperties,
});
const jobIDWithEULATrueAndGuestReadTrue = jobWithEULATrueAndGuestReadTrue.requestId;

const jobWithEULAFalseAndGuestReadFalse = buildJob({
  username: jobOwner,
  collectionIds: [collectionWithEULAFalseAndGuestReadFalse],
  ...baseJobProperties,
});
const jobIDWithEULAFalseAndGuestReadFalse = jobWithEULAFalseAndGuestReadFalse.requestId;

const jobWithEULANonexistent = buildJob({
  username: jobOwner,
  collectionIds: [collectionWithEULANonexistent],
  ...baseJobProperties,
});
const jobIDWithEULANonexistent = jobWithEULANonexistent.requestId;

const jobWithMultipleCollections = buildJob({
  username: jobOwner,
  collectionIds: [collectionWithEULATrueAndGuestsReadTrue, collectionWithEULAFalseAndGuestReadTrue],
  ...baseJobProperties,
});
const jobIDWithMultipleCollections = jobWithMultipleCollections.requestId;

describe('Sharing job results with someone other than its owner', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  hookTransaction();
  before(async function () {
    await jobWithNoCollections.save(this.trx);
    await jobWithEULAFalseAndGuestReadTrue.save(this.trx);
    await jobWithEULATrueAndGuestReadTrue.save(this.trx);
    await jobWithEULAFalseAndGuestReadFalse.save(this.trx);
    await jobWithEULANonexistent.save(this.trx);
    await jobWithMultipleCollections.save(this.trx);
    this.trx.commit();
  });

  describe('For a job (with a single collection)', function () {
    describe('Collection harmony.has-eula tag = false and guest users have CMR read permissions for the collection', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithEULAFalseAndGuestReadTrue, username: notJobOwner });
        it('returns a 200 response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithEULAFalseAndGuestReadTrue, notJobOwner);
        it('returns a 200 response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithEULAFalseAndGuestReadTrue, 0, notJobOwner);
        it('returns a 200 response', function () {
          expect(this.res.statusCode).to.equal(200);
        });
      });
    });

    describe('Collection harmony.has-eula tag = true, but guests users have CMR read permissions for the collection', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithEULATrueAndGuestReadTrue, username: notJobOwner });
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithEULATrueAndGuestReadTrue, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithEULATrueAndGuestReadTrue, 0, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
    });

    describe('Collection harmony.has-eula tag = false, but guest users do not have CMR read permissions', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithEULAFalseAndGuestReadFalse, username: notJobOwner });
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithEULAFalseAndGuestReadFalse, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithEULAFalseAndGuestReadFalse, 0, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
    });

    describe('Collection has no harmony.has-eula tag set', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithEULANonexistent, username: notJobOwner });
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithEULANonexistent, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithEULANonexistent, 0, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
    });

    describe('No collections are used in job', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithNoCollections, username: notJobOwner });
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithNoCollections, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithNoCollections, 0, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
    });
  });

  describe('For a job (with multiple collections) that the owner wants to share', function () {
    describe('For a job with multiple collections (with at least one collection restricted via EULA or CMR permissions)', function () {
      describe('Accessing the job status page', function () {
        hookJobStatus({ jobID: jobIDWithMultipleCollections, username: notJobOwner });
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Catalog page', function () {
        hookStacCatalog(jobIDWithMultipleCollections, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
      describe('Accessing the STAC Item page', function () {
        hookStacItem(jobIDWithMultipleCollections, 0, notJobOwner);
        it('returns a 404 response', function () {
          expect(this.res.statusCode).to.equal(404);
        });
      });
    });
  });
});
