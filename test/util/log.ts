import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createLoggerForTest } from '../helpers/log';
import DataOperation from '../../app/models/data-operation';

describe('util/log', function () {
  describe('jsonLogger', function () {

    let testLogger, getTestLogs;
    beforeEach(function () {
      ({ getTestLogs, testLogger } = createLoggerForTest());
    });

    afterEach(function () {
      console.log(`The test logger output string was:\n${getTestLogs()}`);
      for (const transport of testLogger.transports) {
        transport.close;
      }
      testLogger.close();
    });

    it('logs a <redacted> token when given a DataOperation or DataOperation model', function () {
      const dataOperation = new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      });
      testLogger.info(dataOperation);
      testLogger.info('A message', { 'dataOperation': dataOperation });
      testLogger.info('A message', { 'k': 'v', ...dataOperation });
      testLogger.info('A message', dataOperation);

      testLogger.info(dataOperation.model);
      testLogger.info('A message', { 'dataOperationModel': dataOperation.model });
      testLogger.info('A message', { 'k': 'v', ...dataOperation.model });
      testLogger.info('A message', dataOperation.model);

      expect(getTestLogs()).to.include('"accessToken":"<redacted>"');
      expect(getTestLogs()).to.not.include('"accessToken":"tokenToRedact"');

      // check that the original object wasn't modified
      expect(dataOperation).to.deep.equal(new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      }));
    });

    it('logs a <redacted> token when given a HarmonyRequest-like object', function () {
      const harmonyRequest = {
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      };
      testLogger.info(harmonyRequest);
      testLogger.info('A message', { 'harmonyRequest': harmonyRequest });
      testLogger.info('A message', { 'k': 'v', ...harmonyRequest });
      testLogger.info('A message', harmonyRequest);

      expect(getTestLogs()).to.include('"accessToken":"<redacted>"');
      expect(getTestLogs()).to.not.include('"accessToken":"tokenToRedact"');

      // check that the original object wasn't modified
      expect(harmonyRequest).to.deep.equal({
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      });
    });

    it('logs a <redacted> token from multiple objects', function () {
      const harmonyRequest = {
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      };
      const dataOperation = new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      });
      testLogger.info(harmonyRequest, dataOperation);
      testLogger.info('A message', { 'harmonyRequest': harmonyRequest, 'dataOperation': dataOperation });
      testLogger.info('A message', { 'k': 'v', ...harmonyRequest, ...dataOperation });

      expect(getTestLogs()).to.include('"accessToken":"<redacted>"');
      expect(getTestLogs()).to.not.include('"accessToken":"tokenToRedact"');

      // check that the original object wasn't modified
      expect(harmonyRequest).to.deep.equal({
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      });
      expect(dataOperation).to.deep.equal(new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      }));
    });
  });
});
