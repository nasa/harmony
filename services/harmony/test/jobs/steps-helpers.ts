import { expect } from 'chai';
import { describe, it } from 'mocha';

import { safePublicLink } from '../../app/frontends/steps';

const FRONTEND_ROOT = 'https://harmony.example';
const PRIVATE_FILE_PLACEHOLDER = '<private file location>';

describe('safePublicLink', function () {
  describe('for an href createPublicPermalink can sign (s3 .../public/...)', function () {
    it('returns a Harmony permalink and ignores the destination bucket', function () {
      const href = 's3://staging-bucket/public/abc/granule.nc4';
      const link = safePublicLink(href, FRONTEND_ROOT, 'user-bucket');
      expect(link).to.equal(
        'https://harmony.example/service-results/staging-bucket/public/abc/granule.nc4',
      );
    });
  });

  describe('for an unsignable s3 href (not under /public/)', function () {
    it('passes the href through when it is in the job destination bucket', function () {
      const href = 's3://user-bucket/out/granule.nc4';
      expect(safePublicLink(href, FRONTEND_ROOT, 'user-bucket')).to.equal(href);
    });

    it('hides the href behind the placeholder when it is in a different bucket', function () {
      const href = 's3://someone-else/out/granule.nc4';
      expect(safePublicLink(href, FRONTEND_ROOT, 'user-bucket')).to.equal(PRIVATE_FILE_PLACEHOLDER);
    });

    it('does not treat a bucket-name prefix as a match', function () {
      const href = 's3://user-bucket-nefarious/out/granule.nc4';
      expect(safePublicLink(href, FRONTEND_ROOT, 'user-bucket')).to.equal(PRIVATE_FILE_PLACEHOLDER);
    });

    it('hides the href behind the placeholder when the job has no destinationUrl', function () {
      const href = 's3://artifacts/123/1/outputs/catalog.json';
      expect(safePublicLink(href, FRONTEND_ROOT, undefined)).to.equal(PRIVATE_FILE_PLACEHOLDER);
    });
  });

  describe('for a non-s3 href that createPublicPermalink passes through', function () {
    it('returns an https href unchanged, ignoring the destination bucket', function () {
      const href = 'https://example.com/data/granule.nc4';
      expect(safePublicLink(href, FRONTEND_ROOT, 'user-bucket')).to.equal(href);
    });

    it('returns an ftp href unchanged', function () {
      const href = 'ftp://example.com/data/granule.nc4';
      expect(safePublicLink(href, FRONTEND_ROOT, undefined)).to.equal(href);
    });
  });

  describe('for an href createPublicPermalink cannot handle at all', function () {
    it('hides an unsupported-scheme href behind the placeholder', function () {
      const href = 'file:///etc/passwd';
      expect(safePublicLink(href, FRONTEND_ROOT, 'user-bucket')).to.equal(PRIVATE_FILE_PLACEHOLDER);
    });

    it('hides a non-URL string behind the placeholder', function () {
      expect(safePublicLink('not-a-url', FRONTEND_ROOT, undefined)).to.equal(PRIVATE_FILE_PLACEHOLDER);
    });
  });
});
