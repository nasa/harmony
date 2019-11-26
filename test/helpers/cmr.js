const { before } = require('mocha');
const sinon = require('sinon');
const { cmrApi } = require('../../app/util/cmr');

// Ensures in tests that the Echo-token header is not passed to CMR
before(() => {
  const origGet = cmrApi.get;
  sinon.stub(cmrApi, 'get').callsFake((uri, _options) => origGet(uri));
});
