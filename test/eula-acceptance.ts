import { expect } from 'chai';
import { describe, it } from 'mocha';
import _ from 'lodash';
import { hookRangesetRequest } from './helpers/ogc-api-coverages';
import hookServersStartStop from './helpers/servers';


describe('EULA acceptance validation', function () {

  // Whether or not a collection has a EULA as implied by these variable names
  // depends on whether EULA identifiers are present in the collection's metadata
  const twoEulasCollection = 'C1258836670-EEDTEST';
  const oneEulaCollection = 'C1258839703-EEDTEST';
  const badEulaIdCollection = 'C1258840703-EEDTEST';

  const query = {
    format: 'image/png',
    skipPreview: 'true',
  };

  hookServersStartStop({ skipEarthdataLogin: false });

  describe('When the collection has 2 unaccepted EULAS', function () {
    hookRangesetRequest(
      '1.0.0',
      twoEulasCollection,
      'red_var',
      { query, username: 'joe' },
    );

    it('Provides accept EULA URLs', function () {
      const description = 'Error: You may access the requested data by resubmitting your request after accepting the following EULA(s): ' + 
        'https://uat.urs.earthdata.nasa.gov/accept_eula?eula_id=be7c8c07-65f7-4e63-a81d-78dfa187870e, ' +
        'https://uat.urs.earthdata.nasa.gov/accept_eula?eula_id=a5242e69-dc27-455c-b2bc-1991af58f719.';
      expect(JSON.parse(this.res.text).description).to.eq(description);
    });

    it('Responds with 403 Forbidden', function () {
      expect(this.res.status).to.equal(403);
    });
  });

  describe('When the collection has 2 unaccepted EULAS, requested by shortname', function () {
    hookRangesetRequest(
      '1.0.0',
      'eula-test-harmony_example',
      'red_var',
      { query, username: 'joe' },
    );

    it('Provides accept EULA URLs', function () {
      const description = 'Error: You may access the requested data by resubmitting your request after accepting the following EULA(s): ' + 
        'https://uat.urs.earthdata.nasa.gov/accept_eula?eula_id=be7c8c07-65f7-4e63-a81d-78dfa187870e, ' +
        'https://uat.urs.earthdata.nasa.gov/accept_eula?eula_id=a5242e69-dc27-455c-b2bc-1991af58f719.';
      expect(JSON.parse(this.res.text).description).to.eq(description);
    });

    it('Responds with 403 Forbidden', function () {
      expect(this.res.status).to.equal(403);
    });
  });

  describe('When the collection has 1 unaccepted EULAS', function () {
    hookRangesetRequest(
      '1.0.0',
      oneEulaCollection,
      'red_var',
      { query, username: 'joe' },
    );

    it('Provides accept EULA URLs', function () {
      const description = 'Error: You may access the requested data by resubmitting your request after accepting the following EULA(s): ' + 
        'https://uat.urs.earthdata.nasa.gov/accept_eula?eula_id=be7c8c07-65f7-4e63-a81d-78dfa187870e.';
      expect(JSON.parse(this.res.text).description).to.eq(description);
    });

    it('Responds with 403 Forbidden', function () {
      expect(this.res.status).to.equal(403);
    });
  });

  describe('When the collection has a bad EULA id in the metadata', function () {
    hookRangesetRequest(
      '1.0.0',
      badEulaIdCollection,
      'red_var',
      { query, username: 'joe' },
    );

    it('Tells the user which EULA could not be found', function () {
      const description = 'Error: EULA be7c8c07-65f7-4e63-a81d-78dfa187879x could not be found.';
      expect(JSON.parse(this.res.text).description).to.eq(description);
    });

    it('Responds with 404 Not Found', function () {
      expect(this.res.status).to.equal(404);
    });
  });
});