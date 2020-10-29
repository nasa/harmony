import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, before, after } from 'mocha';
import * as axios from 'axios';
import fs from 'fs';
import hookServersStartStop from './helpers/servers';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import { objectStoreForProtocol } from '../app/util/object-store';

describe('Argo invocations', function () {
  const collection = 'C1096-PVC_TS2'; // Chaining example
  const version = '1.0.0';

  hookServersStartStop();

  describe('calling a service that has an Argo backend', function () {
    describe('calling the backend service', function () {
      let post;
      before(function () {
        post = sinon.stub(axios.default, 'post');
      });

      after(function () {
        post.restore();
      });

      hookRangesetRequest(version, collection, 'all');

      it('invokes an Argo workflow', function () {
        expect(post.calledOnceWith('http://localhost:2746/api/v1/workflows/argo')).to.be.true;
      });

      it('passes CMR query locations to the Query CMR task', async function () {
        const [, body] = post.args[0];
        const template = body.workflow.spec.templates.find((t) => t.name === 'query');
        const { args } = template.container;
        const query = args[3];
        expect(query).to.match(/^s3:\/\//);
        const store = objectStoreForProtocol(query);
        const queryFile = await store.downloadFile(query);

        const cmrQuery = fs.readFileSync(queryFile, 'utf8');
        expect(cmrQuery).to.equal('{}');
      });

      it('passes no granules to the Query CMR input', function () {
        const [, body] = post.args[0];
        const template = body.workflow.spec.templates.find((t) => t.name === 'query');
        const { args } = template.container;
        const message = JSON.parse(args[1]);
        const source = message.sources[0];
        expect(source.collection).to.equal('C1096-PVC_TS2');
        expect(source.granules).to.be.undefined;
      });
    });
  });
});
