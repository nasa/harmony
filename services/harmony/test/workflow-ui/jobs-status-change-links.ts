import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import JobsStatusChangeLinks from '../../public/js/workflow-ui/jobs/jobs-status-change-links';
import { JSDOM } from 'jsdom';
import path from 'path';


describe('JobsStatusChangeLinks', function () {
  const jobsStatusChangeLinks = new JobsStatusChangeLinks();

  describe('getActionableJobIDs()', () => {
    const previewingJobID = '580b48e6-845e-4e83-bcb8-60a1a3b0b6b9';
    const runningJobID = '058184f7-498c-4aa5-a3df-96a3a49b7d19';
    const pausedJobID = '38d2b820-0b52-475d-8cb0-0b9f7775f767';
    beforeEach(async () => {
      const dom = await JSDOM.fromFile(path.resolve(__dirname, 'labels.html'), { url: 'http://localhost' });
      global.window = dom.window as unknown as Window & typeof globalThis;
      global.document = dom.window.document;
    });
    describe('when the jobIDs specified cannot be paused, and the target link=pauser', function () {
      it('returns no job IDs', () => {
        const targetLink = document.querySelector("a.state-change-link[rel='pauser']");
        const actionableJobIDs = jobsStatusChangeLinks.getActionableJobIDs([pausedJobID], targetLink);
        expect(actionableJobIDs.length).to.equal(0);
      });
    });
    describe('when 2 of the 3 jobIDs specified can be paused, and the target link=pauser', function () {
      it('returns 2 job IDs', () => {
        const targetLink = document.querySelector("a.state-change-link[rel='pauser']");
        const actionableJobIDs = jobsStatusChangeLinks.getActionableJobIDs([pausedJobID, runningJobID, previewingJobID], targetLink);
        expect(actionableJobIDs).to.deep.equal([runningJobID, previewingJobID]);
      });
    });
  });
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
      it('Returns 2 job status change links', function () {
        expect(links.length).to.eq(2);
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
      it('Returns pause, cancel and skip preview status change link', function () {
        expect(links.length).to.eq(3);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('pauser');
        expect(linkRels).contains('canceler');
        expect(linkRels).contains('preview-skipper');
      });
    });
    describe('with running and paused statuses', function () {
      let links;
      before(async function () {
        links = jobsStatusChangeLinks.fetchLinksForStatuses(['running', 'paused']);
      });
      it('Returns cancel, resume and pause status change link', function () {
        expect(links.length).to.eq(3);
        const linkRels = links.map((l) => l.rel);
        expect(linkRels).contains('canceler');
        expect(linkRels).contains('resumer');
        expect(linkRels).contains('pauser');
      });
    });
  });
});
