import { expect } from 'chai';
import { describe, it } from 'mocha';

import { serviceIDToCanonicalServiceName } from '../app/util/services';

// Just going to test a few cases that are unlikely to change
describe('serviceIDToCanonicalServiceName', function () {
  const serviceIDs = [
    '266454154769.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/query-cmr:latest',
    'ghcr.io/podaac/l2ss-py', // no tag
    'giovanni-averaging-adapter:1.0.0',
    'hcr.io/podaac/net2cog:SIT',
    'ghcr.io/asfhyp3/opera-rtc-s1-browse:latest',
  ];

  const canonicalNames = [
    'query-cmr',
    'podaac-l2-subsetter',
    'giovanni-averaging-services-adapter',
    'net2cog',
    'opera-rtc-s1-browse',
  ];

  for (const index in serviceIDs) {
    const serviceID = serviceIDs[index];
    const canonicalName = canonicalNames[index];
    it('returns the canonical service name', async () => {
      expect(await serviceIDToCanonicalServiceName(serviceID)).to.equal(canonicalName);
    });
  }
});