import { expect } from 'chai';
import { loadServiceConfigsFromFile, getServiceConfigs, validateServiceConfig } from '../../app/models/services';
import _ from 'lodash';

describe('Services.yml validation', function () {

  describe('harmony services.yml configuration is valid', function () {
    const configs = getServiceConfigs();
    configs.forEach(validateServiceConfig);
  });

  describe('no umm-s in services.yml configuraiton is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile('../../../test/resources/services_no_umm_s.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: gesdisc\/giovanni/);
    });
  });

  describe('services.yml with umm-s as a list is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile('../../../test/resources/services_umm_s_not_string.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/There must be one and only one umm_s record configured as a string for harmony service: podaac\/l2-subsetter/);
    });
  });

});
