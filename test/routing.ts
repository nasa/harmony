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
    message: `${invalidCollection} must be a collection short name or CMR collection identifier, but we could not find a matching collection. Please make sure the collection is correct and that you have access to it.`,
  });

  describeErrorCondition({
    condition: 'accessing multiple collections, one of which is not in CMR',
    path: `/${validCollection}+${invalidCollection}/${wms}`,
    message: `The collection ${invalidCollection} could not be found. Please make sure the collection identifiers are correct and that you have access to each collection.`,
  });

  describeErrorCondition({
    condition: 'accessing multiple collections, multiple of which are not in CMR',
    path: `/${validCollection}+${invalidCollection}+${invalidCollection2}/${wms}`,
    message: `The collections ${invalidCollection} and ${invalidCollection2} could not be found. Please make sure the collection identifiers are correct and that you have access to each collection.`,
  });

  describeErrorCondition({
    condition: 'providing an invalid format for a CMR collection ID',
    path: `/bogus-not-a-cmr-id/${wms}`,
    message: 'bogus-not-a-cmr-id must be a collection short name or CMR collection identifier, but we could not find a matching collection. Please make sure the collection is correct and that you have access to it.',
  });

  describeErrorCondition({
    condition: 'ogc-coverages-api providing an invalid format for a CMR collection ID',
    path: '/BOGUS-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset',
    message: {
      code: 'harmony.NotFoundError',
      description: 'Error: BOGUS-EEDTEST must be a collection short name or CMR collection identifier, but we could not find a matching collection. Please make sure the collection is correct and that you have access to it.',
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
