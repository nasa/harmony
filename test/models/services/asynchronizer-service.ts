import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import Job from 'models/job';
import { defaultObjectStore } from 'util/object-store';
import { hookServersStartStop } from '../../helpers/servers';
import StubService from '../../helpers/stub-service';
import { hookRangesetRequest, hookSyncRangesetRequest } from '../../helpers/ogc-api-coverages';
import { hookRedirect } from '../../helpers/hooks';
import { hookMockS3 } from '../../helpers/object-store';

/**
 * Returns a function whose return value alternates between the supplied values
 *
 * @param {*} values The value to return
 * @returns {function} A function that alterates between the supplied values
 */
function alternateCallbacks(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('Asynchronizer Service', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookMockS3();

  describe('when a service is configured to receive one granule at a time', function () {
    describe('when an asynchronous request arrives', function () {
      StubService.hookAsynchronized(sinon.spy(() => ({ params: { redirect: 'https://example.com/test' } })));
      hookRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();

      it('sends single granules from the request synchronously to the backend, one per input granule', function () {
        expect(this.callbackOptions.callCount).to.equal(20);
      });

      it('provides an asynchronous response to the caller', function () {
        expect(this.res.headers.location).to.include('/jobs/');
      });

      describe('when all service invocations are handled successfully', function () {
        hookRedirect();

        it('marks the job successful', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('successful');
        });
      });
    });

    describe('when a synchronous request arrives', function () {
      StubService.hookAsynchronized(sinon.spy(() => ({ params: { redirect: 'https://example.com/test' } })));
      hookSyncRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();

      it('sends the request directly to the service', function () {
        expect(this.callbackOptions.callCount).to.equal(1);
      });

      it('responds synchronously to the caller', function () {
        expect(this.res.headers.location).to.equal('https://example.com/test');
      });
    });

    describe('when a service invocation calls back with a redirect', function () {
      const s3Path = 's3://localStagingBucket/public/fake/redirect.json';
      before(async function () {
        await defaultObjectStore().upload('"data"', s3Path, null, 'application/json');
      });
      StubService.hookAsynchronized(alternateCallbacks(
        { params: { redirect: 'https://example.com/test' } },
        { params: { redirect: s3Path } },
      ));
      hookRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();
      hookRedirect();
      let job;
      let jobOutputLinks;
      before(function () {
        job = new Job(JSON.parse(this.res.text));
        jobOutputLinks = job.getRelatedLinks('data');
      });

      it('provides the redirect URL to the result as a link href', function () {
        expect(jobOutputLinks[0].href).to.equal('https://example.com/test');
      });

      it('updates the progress of the response', function () {
        expect(job.progress).to.equal(100);
      });

      it('defaults the item type to "application/octet-stream"', function () {
        expect(jobOutputLinks[0].type).to.equal('application/octet-stream');
      });

      describe('and the redirect points to an object store location with Content-Type metadata', function () {
        it('sets the item to type to the Content-Type stored in the object store', function () {
          expect(jobOutputLinks[1].type).to.equal('application/json');
        });
      });
    });

    describe('when a service invocation calls back with a streaming response', function () {
      StubService.hookAsynchronized(alternateCallbacks(
        { body: '["response1"]' },
        { body: '["response2"]', headers: { 'Content-Disposition': 'attachment; filename="myfile.json"' } },
        { body: '["response3"]', headers: { 'Content-Type': 'application/json' } },
      ));
      hookRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();
      hookRedirect();
      let job;
      let jobOutputLinks;
      before(function () {
        job = new Job(JSON.parse(this.res.text));
        jobOutputLinks = job.getRelatedLinks('data');
      });

      it('provides a link to the contents of the streaming response', async function () {
        // Check a result somewhere toward the middle of the list that we expect to be the same as
        // the first result to have some assurance that the async/await code is working properly.
        const obj = jobOutputLinks[12].href.split('/service-results/')[1];
        const contents = await defaultObjectStore().getObject(`s3://${obj}`).promise();
        expect(contents.Body.toString('utf-8')).to.equal('["response1"]');
      });

      it('derives a default uploaded file name from the granule name', function () {
        expect(jobOutputLinks[0].href).to.match(/\/001_00_7f00ff_global_processed$/);
      });

      describe('and the response contains a "Content-Disposition" header', function () {
        it('sets the uploaded file name to the value in the header', function () {
          expect(jobOutputLinks[1].href).to.match(/\/myfile.json$/);
        });
      });

      describe('and the response contains a "Content-Type" header', function () {
        it('sets the item type to the value in the header', function () {
          expect(jobOutputLinks[2].type).to.equal('application/json');
        });
      });
    });

    describe('when a service invocation calls back with an error streaming response', function () {
      StubService.hookAsynchronized(alternateCallbacks(
        { params: { redirect: 'https://example.com/test1' } },
        { params: { redirect: 'https://example.com/test2' } },
        { params: { error: 'Failure from test' } },
      ));
      hookRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion(true);
      hookRedirect();

      it('marks the asynchronous job as having failed', function () {
        const job = JSON.parse(this.res.text);
        expect(job.status).to.eql('failed');
      });

      it('places the supplied error message in the result', function () {
        const job = JSON.parse(this.res.text);
        expect(job.message).to.eql('Failure from test');
      });
    });
  });
});
