import { expect } from 'chai';
import { describe, it } from 'mocha';
import { hookServersStartStop } from './helpers/servers';
import { hookCloudAccessJson, hookCloudAccessSh, hookAwsSts, sampleCloudAccessShResponse } from './helpers/cloud-access';

describe('Cloud access', function () {
  hookServersStartStop({ skipEarthdataLogin: false });
  hookAwsSts();

  describe('When not authenticated', function () {
    describe('Calls to the cloud access json endpoint', function () {
      hookCloudAccessJson();
      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(303);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });
    });
    describe('Calls to the cloud access shell script endpoint', function () {
      hookCloudAccessSh();
      it('redirects to Earthdata Login', function () {
        expect(this.res.statusCode).to.equal(303);
        expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
      });
    });
  });

  describe('When authenticated', function () {
    describe('Calls to the cloud access json endpoint', function () {
      hookCloudAccessJson({ username: 'joe-tester' });

      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a JSON response', function () {
        expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
      });

      it('returns an access key', function () {
        const { AccessKeyId } = JSON.parse(this.res.text);
        expect(AccessKeyId).to.match(/^[0-9A-Z]{20}$/);
      });

      it('returns a secret access key', function () {
        const { SecretAccessKey } = JSON.parse(this.res.text);
        expect(SecretAccessKey).to.match(/^\S{40}$/);
      });

      it('returns a session token', function () {
        const { SessionToken } = JSON.parse(this.res.text);
        expect(SessionToken).to.match(/^\S{356}$/);
      });

      it('returns an expiration datetime', function () {
        const { Expiration } = JSON.parse(this.res.text);
        expect(Expiration).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      });
    });

    describe('Calls to the cloud access shell script endpoint', function () {
      hookCloudAccessSh({ username: 'joe-tester' });
      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a shell script content type', function () {
        expect(this.res.get('Content-Type')).to.equal('application/x-sh; charset=utf-8');
      });

      it('returns the correct shell script content', function () {
        expect(this.res.text).to.equal(sampleCloudAccessShResponse);
      });
    });
  });
});
