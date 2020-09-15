import { before } from 'mocha';
import { cmrApiConfig } from '../../app/util/cmr';

// Ensures in tests that the Authorization header is not passed to CMR
before(() => {
  cmrApiConfig.useToken = false;
});
