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
      const objToLog = new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      });
      testLogger.info(objToLog);
      testLogger.info('A message', { 'dataOperation': objToLog });
      testLogger.info('A message', { 'k': 'v', ...objToLog });
      testLogger.info('A message', objToLog);

      testLogger.info(objToLog.model);
      testLogger.info('A message', { 'dataOperationModel': objToLog.model });
      testLogger.info('A message', { 'k': 'v', ...objToLog.model });
      testLogger.info('A message', objToLog.model);

      expect(getTestLogs()).to.include('"accessToken":"<redacted>"');
      expect(getTestLogs()).to.not.include('"accessToken":"tokenToRedact"');

      // check that the original object wasn't modified
      expect(objToLog).to.deep.equal(new DataOperation({
        accessToken: 'tokenToRedact',
        sources: [],
        format: {},
        subset: {},
      }));
    });

    it('logs a <redacted> token when given a HarmonyRequest-like object', function () {
      const objToLog = {
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      };
      testLogger.info(objToLog);
      testLogger.info('A message', { 'harmonyRequest': objToLog });
      testLogger.info('A message', { 'k': 'v', ...objToLog });
      testLogger.info('A message', objToLog);

      expect(getTestLogs()).to.include('"accessToken":"<redacted>"');
      expect(getTestLogs()).to.not.include('"accessToken":"tokenToRedact"');

      // check that the original object wasn't modified
      expect(objToLog).to.deep.equal({
        operation: new DataOperation({
          accessToken: 'tokenToRedact',
          sources: [],
          format: {},
          subset: {},
        }),
      });
    });
  });
});
