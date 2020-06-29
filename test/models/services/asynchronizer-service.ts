import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { S3 } from 'aws-sdk';
import AsynchronizerService from 'models/services/asynchronizer-service';
import DataOperation from 'models/data-operation';
import * as fs from 'fs';
import * as path from 'path';
import { Job } from '../../../app/models/job';
import { defaultObjectStore } from '../../../app/util/object-store';
import hookServersStartStop from '../../helpers/servers';
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
function alternateCallbacks<T>(...values: T[]): Function {
  let i = 0;
  return (): T => values[i++ % values.length];
}

describe('Asynchronizer Service', function () {
  describe('#constructor', function () {
    const validOperation = new DataOperation(
      JSON.parse(fs.readFileSync(path.join(
        './test/resources/data-operation-samples',
        'valid-operation-input.json',
      )).toString()),
    );

    describe('when setting the concurrency > 1', function () {
      describe('when setting single_granule_requests to true', function () {
        const call = (): AsynchronizerService<unknown> => new AsynchronizerService(
          StubService,
          { name: 'test', type: { name: 'test-single', single_granule_requests: true }, concurrency: 2 },
          validOperation,
        );
        it('throws an error', function () {
          expect(call).to.throw(TypeError);
        });
      });

      describe('when not setting single_granule_requests to true', function () {
        const call = (): AsynchronizerService<unknown> => new AsynchronizerService(
          StubService,
          { name: 'test', type: { name: 'test-sync', synchronous_only: true }, concurrency: 2 },
          validOperation,
        );
        it('does not throw an error', function () {
          expect(call).to.not.throw;
        });
      });
    });
  });

  hookServersStartStop({ skipEarthdataLogin: false });
  hookMockS3();

  describe('when a service is configured to receive one granule at a time', function () {
    describe('when an asynchronous request arrives', function () {
      StubService.hookAsynchronized(
        sinon.spy(() => ({ params: { redirect: 'https://example.com/test' } })),
        { single_granule_requests: true },
      );
      hookRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();

      it('sends single granules from the request to the backend, one per input granule', function () {
        expect(this.callbackOptions.callCount).to.equal(20);
      });

      it('redirects to the job status', function () {
        expect(this.res.headers.location).to.include('/jobs/');
      });

      describe('when all service invocations are handled successfully', function () {
        hookRedirect();

        it('marks the job successful', function () {
          const job = JSON.parse(this.res.text);
          expect(job.status).to.eql('successful');
        });

        it('sets the progress to 100', function () {
          const job = new Job(JSON.parse(this.res.text));
          expect(job.progress).to.equal(100);
        });

        it('includes links for all 20 granules', function () {
          const job = new Job(JSON.parse(this.res.text));
          const dataLinks = job.getRelatedLinks('data');
          expect(dataLinks.length).to.equal(20);
        });
      });
    });

    describe('when a synchronous request arrives', function () {
      StubService.hookAsynchronized(
        sinon.spy(() => ({ params: { redirect: 'https://example.com/test' } })),
        { single_granule_requests: true },
      );
      hookSyncRangesetRequest();
      StubService.hookAsynchronizedServiceCompletion();

      it('sends the request directly to the service', function () {
        expect(this.callbackOptions.callCount).to.equal(1);
      });

      it('responds synchronously to the caller', function () {
        expect(this.res.headers.location).to.equal('https://example.com/test');
      });
    });
  });

  describe('when a service is configured to only respond synchronously', function () {
    describe('when a request that would normally be handled asynchronously arrives', function () {
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
        { body: '["response1"]', headers: { 'Content-Disposition': 'attachment; filename="file1.json"' } },
        { body: '["response2"]', headers: { 'Content-Disposition': 'attachment; filename="file2.json"' } },
        { body: '["response3"]', headers: { 'Content-Disposition': 'attachment; filename="file3.json"', 'Content-Type': 'application/json' } },
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
        const contents: S3.GetObjectOutput = await new Promise((resolve, reject) => {
          defaultObjectStore().getObject(`s3://${obj}`, (err, body) => {
            if (err) reject(err);
            else resolve(body);
          });
        });
        expect(contents.Body.toString('utf-8')).to.equal('["response1"]');
      });

      describe('and the response contains a "Content-Disposition" header', function () {
        it('sets the uploaded file name to the value in the header', function () {
          expect(jobOutputLinks[1].href).to.match(/\/file2.json$/);
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
