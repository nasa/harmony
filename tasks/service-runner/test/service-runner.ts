import { expect } from 'chai';
import { describe, it } from 'mocha';
import env from '../app/util/env';
import WorkItem from '../../../app/models/work-item';
import { objectStoreForProtocol } from '../../../app/util/object-store';
import * as serviceRunner from '../app/service/service-runner';
import { resolve } from '../../../app/util/url';
import { createLoggerForTest } from '../../../test/helpers/log';
import { getItemLogsLocation, WorkItemRecord } from '../../../app/models/work-item-interface';
import { uploadLogs } from '../app/service/service-runner';

const { _getErrorMessage, _getStacCatalogs } = serviceRunner.exportedForTesting;

const errorLogRecord = `
{
  "application": "query-cmr",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "bad stuff",
  "level": "error",
  "timestamp": "2021-09-14T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
`;
const errorLog = `
{
  "application": "query-cmr",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "found granules",
  "level": "info",
  "timestamp": "2021-09-13T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
${errorLogRecord}
{
  "application": "query-cmr",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "second error",
  "level": "error",
  "timestamp": "2021-09-14T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
`;

const nonErrorLog = `
{
  "application": "query-cmr",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "found granules",
  "level": "info",
  "timestamp": "2021-09-13T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
`;

const workItemWithErrorJson = 's3://stac-catalogs/abc/123/outputs/';
const workItemWithoutErrorJson = 's3://stac-catalogs/abc/456/outputs/';
const emptyLog = '';

describe('Service Runner', function () {
  describe('_getErrorMessage()', function () {
    before(async function () {
      const s3 = objectStoreForProtocol('s3');
      const errorJson = JSON.stringify({ 'error': 'Service error message', 'category': 'Service' });
      const errorJsonUrl = resolve(workItemWithErrorJson, 'error.json');
      await s3.upload(errorJson, errorJsonUrl, null, 'application/json');
    });
    describe('when there is an error.json file associated with the WorkItem', async function () {
      it('returns the error message from error.json', async function () {
        const errorMessage = await _getErrorMessage(errorLog, workItemWithErrorJson);
        expect(errorMessage).equal('Service error message');
      });
    });
    describe('when the error log has ERROR level entries', async function () {
      it('returns the first error log entry', async function () {
        const errorMessage = await _getErrorMessage(errorLog, workItemWithoutErrorJson);
        expect(errorMessage).equal('bad stuff');
      });
    });
    describe('when the error log has no ERROR level entries', async function () {
      it('returns "unknown error"', async function () {
        const errorMessage = await _getErrorMessage(nonErrorLog, workItemWithoutErrorJson);
        expect(errorMessage).equal('Unknown error');
      });
    });
    describe('when the error log is empty', async function () {
      it('returns "unknown error"', async function () {
        const errorMessage = await _getErrorMessage(emptyLog, workItemWithoutErrorJson);
        expect(errorMessage).equal('Unknown error');
      });
    });
    describe('when the error log is null', async function () {
      it('returns "unknown error"', async function () {
        const errorMessage = await _getErrorMessage(null, workItemWithoutErrorJson);
        expect(errorMessage).equal('Unknown error');
      });
    });
  });

  describe('uploadLogs', function () {
    const itemRecord0: any = { id: 0, jobID: '123' };
    const itemRecord1: any = { id: 1, jobID: '123' };
    const s3 = objectStoreForProtocol('s3');
    before(async function () {
      // One of the items will have its log file written to twice
      await uploadLogs(itemRecord0, ['the old logs']);
      await uploadLogs(itemRecord0, ['the new logs']);
      await uploadLogs(itemRecord1, ['the only logs']);
    });
    describe('when there is a logs file already associated with the WorkItem', async function () {
      it('appends the new logs to the old ones', async function () {
        const logsLocation0 = getItemLogsLocation(itemRecord0);
        const logs = s3.getObjectJson(logsLocation0);
        expect(logs).to.equal(['the old logs', 'the new logs']);
      });
    });
    describe('when there is no logs file associated with the WorkItem', async function () {
      it('writes the logs to a new file', async function () {
        const logsLocation1 = getItemLogsLocation(itemRecord1);
        const logs = s3.getObjectJson(logsLocation1);
        expect(logs).to.equal(['the new logs']);
      });
    });
  });

  describe('_getStacCatalogs', function () {
    const nonEmptyCatalogUrl = 's3://stac-catalogs/some/';
    const emptyCatalogUrl = 's3://stac-catalogs/empty/';
    before(async function () {
      const s3 = objectStoreForProtocol('s3');
      const errorJson = JSON.stringify({});
      const catalogUrl = resolve(nonEmptyCatalogUrl, 'catalog0.json');
      await s3.upload(errorJson, catalogUrl, null, 'application/json');
    });
    describe('when the directory has catalogs', async function () {
      it('returns the list of catalogs', async function () {
        const files = await _getStacCatalogs(nonEmptyCatalogUrl);
        expect(files).to.eql(['s3://stac-catalogs/some/catalog0.json']);
      });
    });

    describe('when the directory has no catalogs', async function () {
      it('returns any empty list', async function () {
        const files = await _getStacCatalogs(emptyCatalogUrl);
        expect(files).to.eql([]);
      });
    });
  });

  describe('runQueryCmrFromPull', async function () {
    describe('when an error occurs', async function () {
      const workItem = new WorkItem({
        jobID: '123',
        serviceID: 'abc',
        workflowStepIndex: 0,
        scrollID: 1234,
        operation: { requestID: 'foo' },
        id: 1,
      });
      it('returns an error message', async function () {
        const result = await serviceRunner.runQueryCmrFromPull(workItem);
        expect(result.error).to.be.not.empty;
      });
    });
  });

  describe('runServiceFromPull', async function () {
    describe('when an error occurs', async function () {
      const invocArgs = env.invocationArgs;
      const workItem = new WorkItem({
        jobID: '123',
        serviceID: 'abc',
        workflowStepIndex: 1,
        operation: { requestID: 'foo' },
        id: 1,
      });
      beforeEach(function () {
        env.invocationArgs = 'abc\n123';
      });

      afterEach(function () {
        env.invocationArgs = invocArgs;
      });

      it('returns an error message', async function () {
        const result = await serviceRunner.runServiceFromPull(workItem);
        expect(result.error).to.be.not.empty;
      });
    });
  });

  describe('LogStream', function () {
    
    const message = 'mv \'/tmp/tmpkwxpifmr/tmp-result.tif\' \'/tmp/tmpkwxpifmr/result.tif\'';
    const user = 'bo';
    const timestamp =  '2022-10-06T17:04:21.090726Z';
    const requestId = 'cdea7cb8-4c77-4342-8f00-6285e32c9123';
    const level = 'INFO';
    
    const textLog = `${timestamp} [${level}] [harmony-service.cmd:199] ${message}`;
    const jsonLog = `{ "level":"${level}", "message":"${message}", "user":"${user}", "requestId":"${requestId}", "timestamp":"${timestamp}"}`;
    
    describe('_handleLogString with a JSON logger', function () {

      before(function () {
        const { getTestLogs, testLogger } = createLoggerForTest(true);
        this.testLogger = testLogger;
        this.logStream = new serviceRunner.LogStream(testLogger);
        this.logStream._handleLogString(textLog);
        this.logStream._handleLogString(jsonLog);
        
        const testLogs = getTestLogs();
        this.testLogsArr = testLogs.split('\n');
        this.textLogOutput = JSON.parse(this.testLogsArr[0]);
        this.jsonLogOutput = JSON.parse(this.testLogsArr[1]);
      });
  
      after(function () {
        for (const transport of this.testLogger.transports) {
          transport.close;
        }
        this.testLogger.close();
      });
  
      it('saves each log to an array in the original format, as a string or JSON', function () {
        expect(this.logStream.logStrArr.length == 2);
        expect(this.logStream.logStrArr[0] === JSON.parse(jsonLog));
        expect(this.logStream.logStrArr[1] === textLog);
      });

      it('outputs the proper quantity of logs to the log stream', function () {
        expect(this.testLogsArr.length == 2);
      });

      it('sets the appropriate message for each log', function () {
        expect(this.textLogOutput.message).to.equal(textLog);
        expect(this.jsonLogOutput.message).to.equal(message);
      });

      it('sets custom attributes appropriately for each log', function () {
        expect(this.jsonLogOutput.user).to.equal(user);
        expect(this.jsonLogOutput.requestId).to.equal(requestId);
        
        expect(this.textLogOutput.worker).to.equal(true);
        expect(this.jsonLogOutput.worker).to.equal(true);
      });

      it('does not override manager container log attributes with those from the worker container', function () {
        expect(this.textLogOutput.timestamp).to.not.equal(timestamp);
        expect(this.jsonLogOutput.timestamp).to.not.equal(timestamp);
        expect(this.jsonLogOutput.workerTimestamp).to.equal(timestamp);

        expect(this.textLogOutput.level.toLowerCase()).to.equal('debug');
        expect(this.jsonLogOutput.level.toLowerCase()).to.equal('debug');
        expect(this.jsonLogOutput.workerLevel.toLowerCase()).to.equal(level.toLowerCase());
      });
    });

    describe('_handleLogString with a text logger', function () {
  
      before(function () {
        const { getTestLogs, testLogger } = createLoggerForTest(false);
        this.testLogger = testLogger;
        this.logStream = new serviceRunner.LogStream(testLogger);
        this.logStream._handleLogString(textLog);
        this.logStream._handleLogString(jsonLog);        
        this.testLogs = getTestLogs();
      });
  
      after(function () {
        for (const transport of this.testLogger.transports) {
          transport.close;
        }
        this.testLogger.close();
      });
  
      it('saves each log to an array in the original format, as a string or JSON', function () {
        expect(this.logStream.logStrArr.length == 2);
        expect(this.logStream.logStrArr[0] === JSON.parse(jsonLog));
        expect(this.logStream.logStrArr[1] === textLog);
      });

      it('outputs the proper quantity of logs to the log stream', function () {
        expect(this.testLogs.split('\n').length == 2);
      });

      it('outputs the appropriate text to the log stream', function () {
        const jsonLogOutput = `[${requestId}]: ${message}`;
        expect(this.testLogs.includes(textLog));
        expect(this.testLogs.includes(jsonLogOutput));
      });
    });

    describe('aggregateLogStr with a JSON logger', function () {
  
      before(function () {
        const { testLogger } = createLoggerForTest(true);
        this.testLogger = testLogger;
        this.logStream = new serviceRunner.LogStream(testLogger);
        this.logStream._handleLogString(nonErrorLog);
        this.logStream._handleLogString(errorLogRecord);
      });
  
      after(function () {
        for (const transport of this.testLogger.transports) {
          transport.close;
        }
        this.testLogger.close();
      });
  
      it('can provide an aggregate log string to _getErrorMessage', async function () {
        const errorMessage = await _getErrorMessage(this.logStream.aggregateLogStr, workItemWithoutErrorJson);
        expect(errorMessage).equal('bad stuff');
      });
    });
  });
});
