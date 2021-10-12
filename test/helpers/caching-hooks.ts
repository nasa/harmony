import FormData from 'form-data';
import { before, after } from 'mocha';
import { stub, SinonStub } from 'sinon';
import { hookMockS3 } from './object-store';
import * as cmr from '../../app/util/cmr';

hookMockS3();

process.env.REPLAY = process.env.REPLAY || 'record';
require('replay');

// Patch our requests so they work repeatably in node-replay with multipart form
// data.
// Three things need to happen:
//   1. The multipart boundary created by FormData needs to not be random,
//      because node-replay fails to match random content
//   2. Filenames need to be consistent, not generated from tempfiles
//   3. `fetch` needs to be called with strings not FormData, because
//      node-replay cannot record streaming bodies
const originalFetchPost = cmr.fetchPost;
// Typescript doesn't see the _getContentDisposition method
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalDisposition = (FormData.prototype as any)._getContentDisposition;
before(function () {
  // Stub getBoundary to return a consistent multipart form boundary
  stub(FormData.prototype, 'getBoundary').callsFake(function () {
    return '----------------------------012345678901234567890123';
  });

  // Stub append to use a consistent filename for shapefiles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stub(FormData.prototype as any, '_getContentDisposition').callsFake(function (value, options) {
    return originalDisposition(value, options) ? 'filename="shapefile"' : undefined;
  });

  // Stub fetchPost to provide a string body rather than a FormData stream
  stub(cmr, 'fetchPost').callsFake(async function (
    path: string, formData: FormData, headers: { [key: string]: string },
  ): Promise<cmr.CmrResponse> {
    // Read the body into a stream
    const chunks = [];
    const body = await new Promise<string>((resolve, reject) => {
      formData.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      formData.on('error', (err) => reject(err));
      formData.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      formData.resume();
    });
    return originalFetchPost(path, body, headers);
  });
});

// Restore the stubs.  In principle this is unnecessary, since it will be
// the last thing to happen before exit of the test suite, but a good practice
after(function () {
  const getBoundary = FormData.prototype.getBoundary as SinonStub;
  if (getBoundary.restore) getBoundary.restore();

  const fetchPost = cmr.fetchPost as SinonStub;
  if (fetchPost.restore) fetchPost.restore();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prototype = FormData.prototype as any;
  const gcd = prototype._getContentDisposition;
  if (gcd.restore) gcd.restore();
});
