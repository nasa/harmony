import { expect } from 'chai';
import { describe, it } from 'mocha';
import _ from 'lodash';
import isUUID from '../app/util/uuid';
import { expectedNoOpJobKeys, itIncludesRequestUrl } from './helpers/jobs';
import { hookPostRangesetRequest, hookRangesetRequest, rangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';
import StubService, { hookServices } from './helpers/stub-service';
import { ServiceConfig } from '../app/models/services/base-service';
import { hookRedirect } from './helpers/hooks';
import { stub } from 'sinon';
import env from '../app/util/env';
import { hookTransactionFailure } from './helpers/db';

describe('EULA acceptance validation', function () {

  // Whether or not a collection has a EULA as implied by these variable names
  // depends on whether EULA identifiers are present in the collection's metadata
  const noEulasCollection = 'C1233800302-EEDTEST';
  const twoEulasCollection = 'C1258836670-EEDTEST';
  const oneEulaCollection = 'C1258839703-EEDTEST';
  const badEulaIdCollection = 'C1258840703-EEDTEST';

  const query = {
    format: 'image/png',
    skipPreview: 'true',
  };

  hookServersStartStop();

  describe('which has 2 unaccepted EULAS', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest(
      '1.0.0',
      collection,
      'red_var',
      { query },
    );

    it('', function () {
      expect(this.res.text).to.include('');
    });

    it('', function () {
      expect(this.res.status).to.equal(400);
    });
  });
});