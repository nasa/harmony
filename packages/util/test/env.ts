import { describe, it } from 'mocha';
import { expect } from 'chai';
import { HarmonyEnv, getValidationErrors } from '../env';

describe('Environment validation', function () {

  describe('When the environment is valid', function () {
    const validEnv: HarmonyEnv = new HarmonyEnv();
    it('does not throw an error when validated', function () {
      expect(() => validEnv.validate()).not.to.Throw;
    });

    it('does not log any errors', function () {
      expect(getValidationErrors(validEnv).length).to.eql(0);
    });
  });

  describe('When the environment is invalid', function () {
    const invalidEnv: HarmonyEnv = new HarmonyEnv();
    invalidEnv.port = -1;
    invalidEnv.callbackUrlRoot = 'foo';
    it('throws an error when validated', function () {
      expect(() => invalidEnv.validate()).to.throw;
    });

    it('logs two errors', function () {
      expect(getValidationErrors(invalidEnv)).to.eql([
        {
          'children': [],
          'constraints': {
            'isUrl': 'callbackUrlRoot must be a URL address',
          },
          'property': 'callbackUrlRoot',
          'value': 'foo',
        },
        {
          'children': [],
          'constraints': {
            'min': 'port must not be less than 0',
          },
          'property': 'port',
          'value': -1,
        },
      ]);
    });
  });
});