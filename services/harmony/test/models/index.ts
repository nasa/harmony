import { expect } from 'chai';
import _ from 'lodash';

import {
  getServiceConfigs, loadServiceConfigs, loadServiceConfigsFromFile, validateServiceConfig,
} from '../../app/models/services';

const cmrEndpoints = {
  'uat': 'https://cmr.uat.earthdata.nasa.gov',
  'prod': 'https://cmr.earthdata.nasa.gov',
};

describe('Services.yml validation', function () {

  describe('harmony getServiceConfigs returned service configuaration is valid', function () {
    const configs = getServiceConfigs();
    configs.forEach(validateServiceConfig);
  });

  describe('harmony services.yaml UAT configuaration is valid', function () {
    const configs = loadServiceConfigs(cmrEndpoints.uat);
    configs.forEach(validateServiceConfig);
  });

  describe('harmony services.yaml PROD configuaration is valid', function () {
    const configs = loadServiceConfigs(cmrEndpoints.prod);
    configs.forEach(validateServiceConfig);
  });

  describe('no umm-s in services.yml configuration in UAT is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_no_umm_s_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: missing-umm-s/);
    });
  });

  describe('can override a missing UMM-S entry with a variable with a list of collections', function () {
    it('does not throw an exception', function () {
      process.env.MISSING_UMM_S_UAT_COLLECTIONS = 'C1-PROV1';
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_no_umm_s_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.not.throw();
      delete process.env.MISSING_UMM_S_UAT_COLLECTIONS;
    });
  });

  describe('no umm-s in services.yml configuration in PROD is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_no_umm_s_prod.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: missing_umm_s_prod/);
    });
  });

  describe('services.yml with umm-s as a list in UAT is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_umm_s_not_string_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: umm_s_not_string/);
    });
  });

  describe('services.yml with umm-s as a list in PROD is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_umm_s_not_string_prod.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: umm_s_not_string/);
    });
  });

  describe('services.yml with collections configuration in UAT is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_with_colls_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Collections cannot be configured for harmony service: with-collections, use umm_s instead./);
    });
  });

  describe('services.yml with collections configuration in PROD is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_colls_prod.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Collections cannot be configured for harmony service: with-collections, use umm_s instead./);
    });
  });

  describe('services.yml with unset is_sequential for query-cmr in UAT is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_with_unset_is_sequential_query_cmr_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Invalid is_sequential undefined. query-cmr steps must always have sequential = true./);
    });
  });

  describe('services.yml with unset is_sequential for query-cmr in PROD is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unset_is_sequential_query_cmr_prod.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Invalid is_sequential undefined. query-cmr steps must always have sequential = true./);
    });
  });

  describe('services.yml with false is_sequential for query-cmr in UAT is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.uat, '../../../test/resources/services_with_false_is_sequential_query_cmr_uat.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Invalid is_sequential false. query-cmr steps must always have sequential = true./);
    });
  });

  describe('services.yml with false is_sequential for query-cmr in PROD is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_false_is_sequential_query_cmr_prod.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Invalid is_sequential false. query-cmr steps must always have sequential = true./);
    });
  });
});
