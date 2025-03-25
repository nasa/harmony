import chai, { expect } from 'chai';
import _ from 'lodash';

import {
  getServiceConfigs, loadServiceConfigs, loadServiceConfigsFromFile, validateServiceConfig,
  validateStepOperations,
} from '../../app/models/services';

// print out full objects instead of truncated ones when a test fails
chai.config.truncateThreshold = 0;

const cmrEndpoints = {
  'uat': 'https://cmr.uat.earthdata.nasa.gov',
  'prod': 'https://cmr.earthdata.nasa.gov',
};

describe('validateStepOperations', function () {

  describe('when the step config conatins the concatenate operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['concatenate'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'concatenate\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.concatenation = true;
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the dimensionSubset operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['dimensionSubset'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'dimensionSubset\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.subsetting = { dimension: true };
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the extend operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['extend'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'extend\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.extend = true;
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the reproject operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['reproject'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'reproject\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.reprojection = true;
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the shapefileSubset operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['shapefileSubset'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'shapefileSubset\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.subsetting = { shape: true };
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the spatialSubset operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['spatialSubset'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'spatialSubset\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.subsetting = { bbox: true };
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the temporalSubset operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['temporalSubset'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'temporalSubset\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.subsetting = { temporal: true };
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });

  describe('when the step config conatins the variableSubset operation', function () {
    const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
    const testConfig = configs[0];
    testConfig.steps[1].operations = ['variableSubset'];
    describe('and the capabilites do not', function () {
      testConfig.capabilities = {};
      it('returns an error message', function () {
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.equal('Service with-unsupported-step-operation step with image ghcr.io/podaac/l2ss-py:sit has operation \'variableSubset\' which is not included in capabilities.');
      });
    });
    describe('and the capabilites do as well', function () {
      it('does not return an error message', function () {
        testConfig.capabilities.subsetting = { variable: true };
        expect(validateStepOperations(testConfig, testConfig.steps[1])).to.be.null;
      });
    });
  });
});

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

  describe('services.yml with service step with invalid operation is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_invalid_step_operations.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Service with-invalid-step-operation step with image .*? has invalid operation 'foo'./);
    });
  });

  describe('services.yml with service step with invalid exists conditional is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_invalid_exists_condition.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Service with-invalid-exists-condition step with image .*? has invalid exists conditional 'reformat'./);
    });
  });

  describe('services.yml with service step with invalid format conditional is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_invalid_format_condition.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Service with-invalid-format-condition step with image .*? has format conditional 'image\/png' which is not included in capabilities./);
    });
  });

  describe('services.yml with service step with unsupported step operation is invalid', function () {
    it('throws an exception', function () {
      const configs = loadServiceConfigsFromFile(cmrEndpoints.prod, '../../../test/resources/services_with_unsupported_step_operation.yml');
      expect(() => configs.forEach(validateServiceConfig)).to.throw(/Service with-unsupported-step-operation step with image .*? has operation 'variableSubset' which is not included in capabilities./);
    });
  });
});
