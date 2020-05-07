import { describe } from 'mocha';

import { describeErrorCondition } from './helpers/errors';
import hookServersStartStop from './helpers/servers';

describe('Routing', function () {
  const wms = 'wms?service=WMS&request=GetCapabilities';
  const wmts = wms.replace('wms', 'wmts');
  const invalidCollection = 'C1234-MISSING';
  const invalidCollection2 = 'C4568-MISSING';
  const validCollection = 'C1233800302-EEDTEST';

  hookServersStartStop();

  describeErrorCondition({
    condition: 'accessing a collection ID that is not in CMR',
    path: `/${invalidCollection}/${wms}`,
    message: `Route must include a CMR collection identifier. The collection with ID ${invalidCollection} could not be found.`,
  });

  describeErrorCondition({
    condition: 'accessing multiple collections, one of which is not in CMR',
    path: `/${validCollection}+${invalidCollection}/${wms}`,
    message: `Route must include a CMR collection identifier. The collection with ID ${invalidCollection} could not be found.`,
  });

  describeErrorCondition({
    condition: 'accessing multiple collections, multiple of which are not in CMR',
    path: `/${validCollection}+${invalidCollection}+${invalidCollection2}/${wms}`,
    message: `Route must include a CMR collection identifier. The collections with IDs ${invalidCollection} and ${invalidCollection2} could not be found.`,
  });

  describeErrorCondition({
    condition: 'providing an invalid format for a CMR collection ID',
    path: `/bogus-not-a-cmr-id/${wms}`,
    message: 'Route must include a CMR collection identifier. bogus-not-a-cmr-id is not a valid collection identifier.',
  });

  describeErrorCondition({
    condition: 'ogc-coverages-api providing an invalid format for a CMR collection ID',
    path: '/BOGUS-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset',
    message: {
      code: 'harmony.NotFoundError',
      description: 'Error: Route must include a CMR collection identifier. BOGUS-EEDTEST is not a valid collection identifier.',
    },
    html: false,
  });

  describeErrorCondition({
    condition: 'mounting a service without a collection ID',
    path: `/${wms}`,
    message: 'Services can only be invoked when a valid collection is supplied in the URL path before the service name.',
  });

  describeErrorCondition({
    condition: 'mounting a service type that does not exist',
    path: `/${validCollection}/${wmts}`,
    message: 'The requested page was not found.',
  });

  describeErrorCondition({
    condition: 'accessing an invalid top-level route',
    path: '/invalid-route',
    message: 'The requested page was not found.',
  });
});
