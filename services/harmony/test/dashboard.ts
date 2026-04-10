/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import sinon from 'sinon';

import { getDashboard } from '../app/frontends/dashboard';
import * as userWork from '../app/models/user-work';
import * as serviceImages from '../app/util/service-images';

describe('getDashboard', () => {
  const sandbox = sinon.createSandbox();
  let req: any;
  let res: any;
  let next: sinon.SinonSpy;
  let getCountsByServiceStub: sinon.SinonStub;
  let imageMapStub: sinon.SinonStub;

  beforeEach(() => {
    req = {
      user: 'test-user',
      context: { logger: { info: sandbox.stub(), error: sandbox.stub() } },
      accepts: sandbox.stub().returns('json'),
      query: {},
    };

    res = {
      json: sandbox.stub(),
      render: sandbox.stub(),
    };

    next = sandbox.spy();

    getCountsByServiceStub = sandbox.stub(userWork, 'getCountsByService');

    imageMapStub = sandbox.stub(serviceImages, 'getImageToServiceMap').returns({
      'ghcr.io/podaac/l2ss-py:3.1.0rc4': 'podaac/l2ss-py',
      'ghcr.io/harmony/query-cmr:latest': 'query-cmr',
      'ghcr.io/harmony/harmony-service-example:latest': 'harmony-service-example',
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns all services sorted alphabetically with version', async () => {
    getCountsByServiceStub.resolves({
      'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 110000 },
    });

    await getDashboard(req, res, next);

    expect(res.json.calledOnce).to.be.true;
    const result = res.json.firstCall.args[0];

    expect(result.version).to.equal('1-alpha');
    expect(Object.keys(result.services)).to.deep.equal([
      'harmony-service-example',
      'podaac/l2ss-py',
      'query-cmr',
    ]);
  });

  it('maps image names to service names and sums queued counts', async () => {
    getCountsByServiceStub.resolves({
      'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 110000 },
    });

    await getDashboard(req, res, next);

    const { services } = res.json.firstCall.args[0];
    expect(services['podaac/l2ss-py'].queued).to.equal(110000);
  });

  it('fills in zero queued for services not present in DB results', async () => {
    getCountsByServiceStub.resolves({});

    await getDashboard(req, res, next);

    const { services } = res.json.firstCall.args[0];
    expect(services['harmony-service-example'].queued).to.equal(0);
    expect(services['query-cmr'].queued).to.equal(0);
    expect(services['podaac/l2ss-py'].queued).to.equal(0);
  });

  it('includes all services from imageToServiceMap even when DB is empty', async () => {
    getCountsByServiceStub.resolves({});

    await getDashboard(req, res, next);

    const { services } = res.json.firstCall.args[0];
    expect(Object.keys(services)).to.have.members([
      'harmony-service-example',
      'podaac/l2ss-py',
      'query-cmr',
    ]);
  });

  it('aggregates queued counts when multiple images map to the same service', async () => {
    imageMapStub.returns({
      'ghcr.io/podaac/l2ss-py:3.1.0rc4': 'podaac/l2ss-py',
      'ghcr.io/podaac/l2ss-py:3.0.0': 'podaac/l2ss-py',
      'ghcr.io/harmony/query-cmr:latest': 'query-cmr',
    });

    getCountsByServiceStub.resolves({
      'ghcr.io/podaac/l2ss-py:3.1.0rc4': { queued: 60000 },
      'ghcr.io/podaac/l2ss-py:3.0.0': { queued: 50000 },
    });

    await getDashboard(req, res, next);

    const { services } = res.json.firstCall.args[0];
    expect(services['podaac/l2ss-py'].queued).to.equal(110000);
  });

  it('includes unknown images from DB that are not in imageToServiceMap', async () => {
    imageMapStub.returns({
      'ghcr.io/harmony/query-cmr:latest': 'query-cmr',
    });

    getCountsByServiceStub.resolves({
      'ghcr.io/some-old-image:deprecated': { queued: 5 },
    });

    await getDashboard(req, res, next);

    const { services } = res.json.firstCall.args[0];
    expect(services['some-old-image']).to.deep.equal({ queued: 5 });
  });

  it('responds with JSON when client accepts JSON', async () => {
    req.accepts.returns('json');
    getCountsByServiceStub.resolves({});

    await getDashboard(req, res, next);

    expect(res.json.calledOnce).to.be.true;
  });

  it('still responds with JSON when client requests HTML (until HTML is implemented)', async () => {
    req.accepts.returns('html');
    getCountsByServiceStub.resolves({});

    await getDashboard(req, res, next);

    expect(res.json.calledOnce).to.be.true;
  });

  it('logs the requesting user', async () => {
    getCountsByServiceStub.resolves({});

    await getDashboard(req, res, next);

    expect(req.context.logger.info.calledOnce).to.be.true;
    expect(req.context.logger.info.firstCall.args[0]).to.include('test-user');
  });

  it('calls next(err) when getCountsByService rejects', async () => {
    const error = new Error('DB connection failed');
    getCountsByServiceStub.rejects(error);

    await getDashboard(req, res, next);

    expect(next.calledOnce).to.be.true;
    expect(next.firstCall.args[0]).to.equal(error);
  });

  it('does not call res.json when an error occurs', async () => {
    getCountsByServiceStub.rejects(new Error('oops'));

    await getDashboard(req, res, next);

    expect(res.json.called).to.be.false;
  });
});
