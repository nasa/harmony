import { before } from 'mocha';
import { cmrApiConfig } from '../../app/util/cmr';

// Ensures in tests that the Echo-token header is not passed to CMR
before(() => {
  cmrApiConfig.useToken = false;
});
