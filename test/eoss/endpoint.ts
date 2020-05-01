import { describe, it } from 'mocha';
import chai from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hookServersStartStop } from '../helpers/servers';
import default from '../helpers/eoss';
const { eossLandingPageRequest, eossSpecRequest } = default;

const { expect } = chai;

describe('EOSS static content endpoints', function () {
  hookServersStartStop();

  describe('Landing Page', function () {
    it('returns an HTTP 200 and the landing page content', async function () {
      const res = await eossLandingPageRequest(this.frontend);
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.equal('text/html; charset=utf-8');
      expect(res.text).to.equal('<p>A fine landing page for now.<p>');
    });
  });

  describe('OpenAPI spec', function () {
    const openApiPath = join(__dirname, '..', '..', 'app', 'schemas', 'eoss', '0.1.0', 'eoss-v0.1.0.yml');
    const openApiContent = readFileSync(openApiPath, 'utf-8');
    it('returns an HTTP 200 and the OpenAPI spec for an EOSS request', async function () {
      const res = await eossSpecRequest(this.frontend, '0.1.0');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.equal('text/x-yaml; charset=utf-8');
      expect(res.text).to.equal(openApiContent);
    });
  });
});
