import { expect } from 'chai';
import { describe, it, before } from 'mocha';
import 'jsdom-global/register';
import * as sinon from 'sinon';
import JobsStatusChangeLinks from '../../public/js/workflow-ui/jobs/jobs-status-change-links';


describe('JobsStatusChangeLinks', function () {
  describe('fetchLinks()', function () {
    let links;
    before(async function () {
      links = JobsStatusChangeLinks.fetchLinks(true);
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
        links = JobsStatusChangeLinks.fetchLinksForStatuses(['paused', 'successful']);
      });
      it('Returns 0 job status change links', function () {
        expect(links.length).to.eq(0);
      });
    });
  });
});
