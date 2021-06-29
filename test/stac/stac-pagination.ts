import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import { Job, JobStatus } from 'models/job';
import JobLink from 'models/job-link';
import { SerializableCatalog } from 'frontends/stac-catalog';
import hookServersStartStop from '../helpers/servers';
import { buildJob, itIncludesPagingRelations, areStacJobLinksEqual } from '../helpers/jobs';
import { hookStacCatalog } from '../helpers/stac';
import db from '../../app/util/db';
import env from '../../app/util/env';

describe('STAC - pagination', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  const links: JobLink[] = [] as JobLink[];
  const aJob = buildJob(
    {
      username: 'joe',
      status: JobStatus.SUCCESSFUL,
      message: 'it is done',
      progress: 100,
      links,
    },
  );
  let defaultResultPageSize;

  before(async function () {
    // use a DEFAULT_RESULT_PAGE size of 10 for these tests
    ({ defaultResultPageSize } = env);
    env.defaultResultPageSize = 10;

    // Generate some links for the job - need to save the job after each link is added to
    // circumvent ordering problems with sqlite
    const jTrx = await db.transaction();
    await aJob.save(jTrx);
    jTrx.commit();
    for (let i = 1; i < 51; i++) {
      links.push(
        new JobLink({
          href: `http://example.com/${i}`,
          title: `Example ${i}`,
          type: i % 2 === 0 ? 'text/plain' : 'text/ornate',
          rel: 'data',
          bbox: '-180,-90,180,90',
          temporal: {
            start: new Date('2020-01-01T00:00:00.000Z'),
            end: new Date('2020-01-02T00:00:00.000Z'),
          },
        }),
      );
    }

    for (const link of links) {
      const trx = await db.transaction();
      aJob.addLink(
        link,
      );
      await aJob.save(trx);
      trx.commit();
    }
  });

  after(function () {
    env.defaultResultPageSize = defaultResultPageSize;
  });

  const jobID = aJob.requestId;
  describe('when `page` parameter is set', function () {
    describe('and the page is a valid page', function () {
      hookStacCatalog(jobID, 'joe', { page: 2 });
      it('shows the corresponding page of results', function () {
        const catalog: SerializableCatalog = JSON.parse(this.res.text);
        const outputLinks = catalog.links.filter((_) => _.rel === 'item');
        expect(areStacJobLinksEqual(links.slice(10, 20), outputLinks)).to.equal(true);
      });
    });

    describe('and the page is a not a valid page', function () {
      hookStacCatalog(jobID, 'joe', { page: 0 });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestValidationError',
          description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
        });
      });
    });

    describe('and the page is not an integer', function () {
      hookStacCatalog(jobID, 'joe', { page: 1.5 });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestValidationError',
          description: 'Error: Parameter "page" is invalid. Must be an integer greater than or equal to 1.',
        });
      });
    });
  });

  describe('when `page` parameter and `limit` are not set', function () {
    hookStacCatalog(jobID, 'joe', {});
    it('shows the first page of results with the default page size', function () {
      const catalog: SerializableCatalog = JSON.parse(this.res.text);
      const outputLinks = catalog.links.filter((_) => _.rel === 'item');
      expect(areStacJobLinksEqual(links.slice(0, 10), outputLinks)).to.equal(true);
    });
  });

  describe('when `limit` parameter is set', function () {
    describe('and the limit is valid', function () {
      hookStacCatalog(jobID, 'joe', { limit: 2 });
      it('shows the corresponding page of results', function () {
        const catalog: SerializableCatalog = JSON.parse(this.res.text);
        const outputLinks = catalog.links.filter((_) => _.rel === 'item');
        expect(areStacJobLinksEqual(links.slice(0, 2), outputLinks)).to.equal(true);
      });
    });

    describe('and the limit is invalid', function () {
      hookStacCatalog(jobID, 'joe', { limit: 10001 });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestValidationError',
          description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 10000.',
        });
      });
    });

    describe('and the limit is not an integer', function () {
      hookStacCatalog(jobID, 'joe', { limit: 2000.5 });
      it('returns a 400 HTTP Bad request response', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestValidationError',
          description: 'Error: Parameter "limit" is invalid. Must be an integer greater than or equal to 0 and less than or equal to 10000.',
        });
      });
    });
  });

  describe('when both `page` and `limit` parameters are set', function () {
    hookStacCatalog(jobID, 'joe', { page: 2, limit: 2 });
    it('shows the corresponding page of results with the correct page size', function () {
      const catalog: SerializableCatalog = JSON.parse(this.res.text);
      const outputLinks = catalog.links.filter((_) => _.rel === 'item');
      expect(areStacJobLinksEqual(links.slice(2, 4), outputLinks)).to.equal(true);
    });
  });

  describe('link relations', function () {
    describe('on the first page', function () {
      hookStacCatalog(jobID, 'joe', { page: 1 });
      it('does not provide a "prev" link relation to the previous result page', function () {
        const catalog = new Job(JSON.parse(this.res.text));
        const relLinks = catalog.links.filter((_) => _.rel === 'prev');
        expect(relLinks.length).to.equal(0);
      });

      it('provides a "next" link relation to the previous result page', function () {
        const catalog = new Job(JSON.parse(this.res.text));
        const relLinks = catalog.links.filter((_) => _.rel === 'next');
        expect(relLinks.length).to.equal(1);
      });
    });

    describe('on the second page', function () {
      hookStacCatalog(jobID, 'joe', { page: 2 });
      itIncludesPagingRelations(5, `stac/${jobID}`, { first: null, prev: 1, self: 2, next: 3, last: 5 });
    });

    describe('on a middle page', function () {
      hookStacCatalog(jobID, 'joe', { page: 3 });
      itIncludesPagingRelations(5, `stac/${jobID}`, { first: 1, prev: 2, self: 3, next: 4, last: 5 });
    });

    describe('on the penultimate page', function () {
      hookStacCatalog(jobID, 'joe', { page: 4 });
      itIncludesPagingRelations(5, `stac/${jobID}`, { first: 1, prev: 3, self: 4, next: 5, last: null });
    });

    describe('on the last page', function () {
      hookStacCatalog(jobID, 'joe', { page: 5 });
      itIncludesPagingRelations(5, `stac/${jobID}`, { first: 1, prev: 4, self: 5, next: null, last: null });
    });

    describe('for a page beyond the last page', function () {
      hookStacCatalog(jobID, 'joe', { page: 6 });
      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestError',
          description: 'Error: The requested paging parameters were out of bounds',
        });
      });
    });

    describe('on a page that is both first and last (the only page)', function () {
      hookStacCatalog(jobID, 'joe', { limit: 100 });
      it('includes only the relation to self, with no paging info', function () {
        const pageLinks = JSON.parse(this.res.text).links;
        expect(pageLinks[0].rel).to.equal('root');
        expect(pageLinks.length).to.equal(52);
        expect(pageLinks[51].rel).to.equal('self');
        expect(pageLinks[51].title).to.equal('The current page');
      });
    });

    describe('on a page with limit 0', function () {
      hookStacCatalog(jobID, 'joe', { limit: 0 });
      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony:RequestError',
          description: 'Error: The requested paging parameters were out of bounds',
        });
      });
    });
  });
});
