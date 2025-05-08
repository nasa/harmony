import { describe, it } from 'mocha';
import { expect } from 'chai';
import { cmrQueryType, hashCmrQuery, CmrRelatedUrl, CmrUmmVariable, getVariablesByIds, getAllVariables, CmrQuery, queryGranuleUsingMultipartForm } from '../../app/util/cmr';

describe('hashCmrQuery', () => {
  const type = cmrQueryType.COLL_JSON;
  const token = 'secret-token';

  it('produces consistent hashes for the same query regardless of key order', () => {
    const queryA = {
      concept_id: ['C123', 'C456'],
      page_size: 10,
    };

    const queryB = {
      page_size: 10,
      concept_id: ['C123', 'C456'],
    };

    const hashA = hashCmrQuery(type, queryA, token);
    const hashB = hashCmrQuery(type, queryB, token);

    expect(hashA).to.equal(hashB).to.equal('3c12c66959008295d6e8f9810ae0f680');
  });

  it('produces different hashes for different tokens', () => {
    const query = { page_size: 10 };
    const hash1 = hashCmrQuery(type, query, 'token1');
    const hash2 = hashCmrQuery(type, query, 'token2');

    expect(hash1).not.to.equal(hash2);
  });

  it('produces different hashes for different query values', () => {
    const query1 = { page_size: 10 };
    const query2 = { page_size: 20 };

    const hash1 = hashCmrQuery(type, query1, token);
    const hash2 = hashCmrQuery(type, query2, token);

    expect(hash1).not.to.equal(hash2);
  });

  it('produces different hashes for different types', () => {
    const query = { page_size: 10 };

    const hash1 = hashCmrQuery(cmrQueryType.COLL_JSON, query, token);
    const hash2 = hashCmrQuery(cmrQueryType.COLL_UMM, query, token);

    expect(hash1).not.to.equal(hash2);
  });

  it('handles empty query objects consistently', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};
    const hash1 = hashCmrQuery(type, query, token);
    const hash2 = hashCmrQuery(type, {}, token);

    expect(hash1).to.equal(hash2);
  });

  it('handles undefined token consistently', () => {
    const query = { page_size: 10 };
    const hash1 = hashCmrQuery(type, query, undefined);
    const hash2 = hashCmrQuery(type, query, undefined);

    expect(hash1).to.equal(hash2);
  });
});

const fakeContext = {
  id: '1234',
};

describe('util/cmr', function () {
  describe('getVariablesByIds', function () {
    it('returns a valid response, given a huge number of variables', async function () {
      const validVariableId = 'V1233801695-EEDTEST';
      const ids = [...Array(300).keys()].map((num) => `V${num}-YOCLOUD`).concat(validVariableId);
      const variables = await getVariablesByIds(fakeContext, ids, '');
      expect(variables.length).to.eql(1);
    });

    it('contains related URLs when the CMR variable has them', async function () {
      const expectedRelatedUrls: CmrRelatedUrl[] = [{
        URL: 'https://colormap_server.earthdata.nasa.gov/sea_surface_temperature/green-based',
        URLContentType: 'VisualizationURL',
        Type: 'Color Map',
        Subtype: 'Harmony GDAL',
        Description: 'This is a sample way of designating a colormap for a specific variable record.',
        Format: 'XML',
        MimeType: 'application/XML',
      }];
      const redVariable: CmrUmmVariable = (await getVariablesByIds(fakeContext, ['V1233801695-EEDTEST'], ''))[0];
      const redVariableRelatedUrls: CmrRelatedUrl[] = redVariable.umm.RelatedURLs;
      expect(expectedRelatedUrls).to.deep.equal(redVariableRelatedUrls);
    });
  });

  describe('getAllVariables', function () {
    it('successfully retrieves all variables over multiple pages', async function () {
      const variableIds = ['V1233801695-EEDTEST', 'V1233801696-EEDTEST', 'V1233801716-EEDTEST', 'V1233801717-EEDTEST'];
      const query = {
        concept_id: variableIds,
        page_size: 1, // requires paging through 4 pages
      };
      const variables = await getAllVariables(fakeContext, query, '');
      expect(variables.length).to.eql(4);
    });
  });

  describe('when issuing a granuleName query with wildcards', function () {
    it('it handles * at the beginning', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '*oceania_east',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(16);

      const querySingleMatch: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '*01_08_7f00ff_oceania_east',
      };
      const singleMatchResults = await queryGranuleUsingMultipartForm(fakeContext, querySingleMatch, '');
      expect(singleMatchResults.hits).to.equal(1);
    });

    it('it handles * in the middle', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_*_east',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(2);

      const querySingleMatch: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_*_7f00ff_oceania_east',
      };
      const singleMatchResults = await queryGranuleUsingMultipartForm(fakeContext, querySingleMatch, '');
      expect(singleMatchResults.hits).to.equal(1);
    });

    it('it handles * at the end', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_*',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(12);

      const querySingleMatch: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_08_7f00ff_oceania_eas*',
      };
      const singleMatchResults = await queryGranuleUsingMultipartForm(fakeContext, querySingleMatch, '');
      expect(singleMatchResults.hits).to.equal(1);
    });

    it('it handles ? at the beginning', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '?01_08_7f00ff_oceania_east',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(1);
    });

    it('it handles ? in the middle', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_08_7f00ff_?ceania_east',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(1);
    });

    it('it handles ? at the end', async function () {
      const query: CmrQuery = {
        concept_id: 'C1233800302-EEDTEST',
        readable_granule_name: '001_08_7f00ff_oceania_eas?',
      };
      const results = await queryGranuleUsingMultipartForm(fakeContext, query, '');
      expect(results.hits).to.equal(1);
    });
  });

});
