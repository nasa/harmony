import { describe, it } from 'mocha';
import { expect } from 'chai';
import { asyncLocalStorage } from '../../app/util/async-store';
import { CmrRelatedUrl, CmrUmmVariable, getVariablesByIds, getAllVariables, CmrQuery, queryGranuleUsingMultipartForm } from '../../app/util/cmr';

const fakeContext = {
  id: '1234',
};

describe('util/cmr', function () {
  describe('getVariablesByIds', function () {
    it('returns a valid response, given a huge number of variables', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const validVariableId = 'V1233801695-EEDTEST';
        const ids = [...Array(300).keys()].map((num) => `V${num}-YOCLOUD`).concat(validVariableId);
        const variables = await getVariablesByIds(ids, '');
        expect(variables.length).to.eql(1);
      });
    });

    it('contains related URLs when the CMR variable has them', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const expectedRelatedUrls: CmrRelatedUrl[] = [{
          URL: 'https://colormap_server.earthdata.nasa.gov/sea_surface_temperature/green-based',
          URLContentType: 'VisualizationURL',
          Type: 'Color Map',
          Subtype: 'Harmony GDAL',
          Description: 'This is a sample way of designating a colormap for a specific variable record.',
          Format: 'XML',
          MimeType: 'application/XML',
        }];
        const redVariable: CmrUmmVariable = (await getVariablesByIds(['V1233801695-EEDTEST'], ''))[0];
        const redVariableRelatedUrls: CmrRelatedUrl[] = redVariable.umm.RelatedURLs;
        expect(expectedRelatedUrls).to.deep.equal(redVariableRelatedUrls);
      });
    });
  });

  describe('getAllVariables', function () {
    it('successfully retrieves all variables over multiple pages', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const variableIds = ['V1233801695-EEDTEST', 'V1233801696-EEDTEST', 'V1233801716-EEDTEST', 'V1233801717-EEDTEST'];
        const query = {
          concept_id: variableIds,
          page_size: 1, // requires paging through 4 pages
        };
        const variables = await getAllVariables(query, '');
        expect(variables.length).to.eql(4);
      });
    });
  });

  describe('when issuing a granuleName query with wildcards', function () {
    it('it handles * at the beginning', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '*oceania_east',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(16);

        const querySingleMatch: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '*01_08_7f00ff_oceania_east',
        };
        const singleMatchResults = await queryGranuleUsingMultipartForm(querySingleMatch, '');
        expect(singleMatchResults.hits).to.equal(1);
      });

    });

    it('it handles * in the middle', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_*_east',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(2);

        const querySingleMatch: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_*_7f00ff_oceania_east',
        };
        const singleMatchResults = await queryGranuleUsingMultipartForm(querySingleMatch, '');
        expect(singleMatchResults.hits).to.equal(1);
      });
    });

    it('it handles * at the end', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_*',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(12);

        const querySingleMatch: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_08_7f00ff_oceania_eas*',
        };
        const singleMatchResults = await queryGranuleUsingMultipartForm(querySingleMatch, '');
        expect(singleMatchResults.hits).to.equal(1);
      });
    });

    it('it handles ? at the beginning', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '?01_08_7f00ff_oceania_east',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(1);
      });
    });

    it('it handles ? in the middle', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_08_7f00ff_?ceania_east',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(1);
      });
    });

    it('it handles ? at the end', async function () {
      await asyncLocalStorage.run(fakeContext, async () => {
        const query: CmrQuery = {
          concept_id: 'C1233800302-EEDTEST',
          readable_granule_name: '001_08_7f00ff_oceania_eas?',
        };
        const results = await queryGranuleUsingMultipartForm(query, '');
        expect(results.hits).to.equal(1);
      });
    });
  });

});
