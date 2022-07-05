import { describe, it } from 'mocha';
import { expect } from 'chai';
import { CmrRelatedUrl, CmrUmmVariable, getVariablesByIds, getAllVariables } from '../../app/util/cmr';

describe('util/cmr', function () {
  describe('getVariablesByIds', function () {
    it('returns a valid response, given a huge number of variables', async function () {
      const validVariableId = 'V1233801695-EEDTEST';
      const ids = [...Array(300).keys()].map((num) => `V${num}-YOCLOUD`).concat(validVariableId);
      const variables = await getVariablesByIds(ids, '');
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
      const redVariable: CmrUmmVariable = (await getVariablesByIds(['V1233801695-EEDTEST'], ''))[0];
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
      const variables = await getAllVariables(query, '');
      expect(variables.length).to.eql(4);
    });
  });


});
