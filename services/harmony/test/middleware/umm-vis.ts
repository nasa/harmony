import { expect } from 'chai';

import DataOperation from '../../app/models/data-operation';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import hookServersStartStop from '../helpers/servers';
import StubService from '../helpers/stub-service';

const collectionId = 'C1273843214-EEDTEST';
const validVariable = 'blue_var';

describe('UMM-Vis', function () {
  hookServersStartStop();
  describe('When `all` is given as the variable', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest('1.0.0', collectionId, 'all', { query: {} });

    it('the data operation contains the collletions visualization records at the top-level in the source', function () {
      const operation = this.service.operation as DataOperation;
      expect(operation.sources[0].visualizations.length).equals(2);
      expect((operation.sources[0].visualizations[0] as { Name: string; }).Name).equal('Harmony_umm_vis_test_1');
      expect((operation.sources[0].visualizations[1] as { Name: string; }).Name).equal('Harmony_umm_vis_test_3');
    });

  });
  describe('When a variable is specified in the url', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest('1.0.0', collectionId, validVariable, { query: {} });

    it('the data operation contains the variable visaulization records underneath the variable in the source', async function () {
      const operation = this.service.operation as DataOperation;
      expect(operation.sources[0].variables[0].visualizations.length).equals(2);
      expect((operation.sources[0].variables[0].visualizations[0] as { Name: string; }).Name).equal('Harmony_umm_vis_test_2');
      expect((operation.sources[0].variables[0].visualizations[1] as { Name: string; }).Name).equal('Harmony_umm_vis_test_3');

    });
    it('the data operation does not include the collection visualizations', async function () {
      const operation = this.service.operation as DataOperation;
      expect(operation.sources[0].visualizations).to.be.undefined;
    });
  });

  describe('When a variable is specified in the url', function () {
    StubService.hook({ params: { redirect: 'http://example.com' } });
    hookRangesetRequest('1.0.0', collectionId, 'parameter_vars', { query: { variable: validVariable } });

    it('the data operation contains the variable visaulization records underneath the variable in the source', async function () {
      const operation = this.service.operation as DataOperation;
      expect(operation.sources[0].variables[0].visualizations.length).equals(2);
      expect((operation.sources[0].variables[0].visualizations[0] as { Name: string; }).Name).equal('Harmony_umm_vis_test_2');
      expect((operation.sources[0].variables[0].visualizations[1] as { Name: string; }).Name).equal('Harmony_umm_vis_test_3');

    });
    it('the data operation does not include the collection visualizations', async function () {
      const operation = this.service.operation as DataOperation;
      expect(operation.sources[0].visualizations).to.be.undefined;
    });
  });
});