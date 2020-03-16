const { before } = require('mocha');
const { cmrApiConfig } = require('../../app/util/cmr');

// Ensures in tests that the Echo-token header is not passed to CMR
before(() => {
  cmrApiConfig.useToken = false;
  // const origGet = cmrApi.get;
  // sinon.stub(cmrApi, 'get').callsFake((uri, _options) => origGet(uri));
});
