import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import JobsStatusChangeLinks from '../../public/js/workflow-ui/jobs/jobs-status-change-links';


describe('JobsStatusChangeLinks', function () {
  const jobsStatusChangeLinks = new JobsStatusChangeLinks();
  describe('fetchLinks()', function () {
    let links;
    before(async function () {
      links = await jobsStatusChangeLinks.fetchLinks(true);
    });
    it('Returns all job status change links', function () {
      expect(links.length).to.eq(4);
      const linkRels = links.map((l) => l.rel);
      expect(['canceler', 'pauser', 'resumer', 'preview-skipper']).deep.eq(linkRels);
    });
  });
  describe('fetchLinksForStatuses()', function () {
    describe('with incompatible statuses', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['paused', 'successful']);
      });
      it('Returns 0 job status change links', function () {
        expect(links.length).to.eq(0);
      });
    });
    describe('with paused status', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['paused']);
      });
      it('Returns resume and cancel status change link', function () {
        expect(links.length).to.eq(2);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('resumer');
        expect(linkRels).contains('canceler');
      });
    });
    describe('with running status', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['running']);
      });
      it('Returns pause and cancel status change link', function () {
        expect(links.length).to.eq(2);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('pauser');
        expect(linkRels).contains('canceler');
      });
    });
    describe('with previewing status', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['previewing', 'previewing']);
      });
      it('Returns skip preview, pause and cancel status change link', function () {
        expect(links.length).to.eq(3);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('preview-skipper');
        expect(linkRels).contains('pauser');
        expect(linkRels).contains('canceler');
      });
    });
    describe('with running and running_with_errors statuses', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['running', 'running_with_errors']);
      });
      it('Returns pause and cancel status change link', function () {
        expect(links.length).to.eq(2);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('pauser');
        expect(linkRels).contains('canceler');
      });
    });
    describe('with running and previewing statuses', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['running', 'previewing']);
      });
      it('Returns pause and cancel status change link', function () {
        expect(links.length).to.eq(2);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('pauser');
        expect(linkRels).contains('canceler');
      });
    });
    describe('with running and paused statuses', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['running', 'paused']);
      });
      it('Returns cancel status change link', function () {
        expect(links.length).to.eq(1);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('canceler');
      });
    });
  });
});
