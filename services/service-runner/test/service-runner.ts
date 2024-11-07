/* eslint-disable @typescript-eslint/no-throw-literal */
import { expect } from 'chai';
import * as k8s from '@kubernetes/client-node';
import { describe, it } from 'mocha';
import env from '../app/util/env';
import WorkItem from '../../harmony/app/models/work-item';
import { objectStoreForProtocol } from '../../harmony/app/util/object-store';
import * as serviceRunner from '../app/service/service-runner';
import { resolve } from '../../harmony/app/util/url';
import { createLoggerForTest } from '../../harmony/test/helpers/log';
import { getItemLogsLocation, WorkItemRecord } from '../../harmony/app/models/work-item-interface';
import { uploadLogs } from '../app/service/service-runner';
import sinon from 'sinon';
import axios from 'axios';
import { readFileSync } from 'fs';

const { _getErrorMessage, _getStacCatalogs } = serviceRunner.exportedForTesting;

const exampleStatus: k8s.V1Status = {
  message: 'example status',
};

const oomStatusCause: k8s.V1StatusCause = {
  reason: 'ExitCode',
  message: '137',
};

const oomStatusDetails: k8s.V1StatusDetails = {
  causes: [oomStatusCause],
};

const oomStatus: k8s.V1Status = {
  details: oomStatusDetails,
};

const workItemWithErrorJson = 's3://stac-catalogs/abc/123/outputs/';
const workItemWithoutErrorJson = 's3://stac-catalogs/abc/456/outputs/';

const dummyCatalog = {
  'stac_version': '1.0.0-beta.2',
  'stac_extensions': [],
  'id': 'e8c152dd-112f-499d-9307-65a21ecb0ae6',
  'links': [
    {
      'rel': 'harmony_source',
      'href': 'https://cmr.uat.earthdata.nasa.gov/search/concepts/C1234208438-POCLOUD',
    },
    {
      'rel': 'item',
      'href': './granule_G1234495188-POCLOUD_0000000.json',
      'type': 'application/json',
      'title': 'JA1_GPS_2PeP220_111_20071231_005214_20071231_014826',
    },
  ],
  'description': 'CMR collection C1234208438-POCLOUD, granule G1234495188-POCLOUD',

};

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
        const errorMessage = await _getErrorMessage(exampleStatus, workItemWithErrorJson);
        expect(errorMessage).equal('Service error message');
      });
    });
    describe('when the error status code is 137', async function () {
      it('returns "OOM error"', async function () {
        const errorMessage = await _getErrorMessage(oomStatus, workItemWithoutErrorJson);
        expect(errorMessage).equal('Service failed due to running out of memory');
      });
    });
  });

  describe('_getStacCatalogs()', function () {

    const workItemWithOneCatalog = 's3://stac-catalogs/abc/789/outputs/';
    const workItemWithMultipleCatalogs = 's3://stac-catalogs/abc/321/outputs/';
    const workItemWithMultipleCatalogsNoBatchFile = 's3://stac-catalogs/abc/987/outputs/';
    const emptyCatalogUrl = 's3://stac-catalogs/empty/';

    describe('when the directory has no catalogs', async function () {
      it('returns any empty list', async function () {
        const files = await _getStacCatalogs(emptyCatalogUrl);
        expect(files).to.eql([]);
      });
    });

    describe('when there is a batch-catalogs.json file associated with the WorkItem', async function () {
      before(async function () {
        const s3 = objectStoreForProtocol('s3');
        const batchFileContent = JSON.stringify([
          'catalog0.json',
          'catalog1.json',
          'catalog2.json',
          'catalog3.json',
          'catalog4.json',
          'catalog5.json',
          'catalog6.json',
          'catalog7.json',
          'catalog8.json',
          'catalog9.json',
          'catalog10.json',
        ]);
        const stacCatalogsUrl = resolve(workItemWithMultipleCatalogs, 'batch-catalogs.json');
        await s3.upload(batchFileContent, stacCatalogsUrl, null, 'application/json');
      });

      it('returns the stac catalogs from batch-catalogs.json in the order they are in the file', async function () {
        const stacCatalogs = await _getStacCatalogs(workItemWithMultipleCatalogs);
        expect(stacCatalogs).to.deep.equal([
          's3://stac-catalogs/abc/321/outputs/catalog0.json',
          's3://stac-catalogs/abc/321/outputs/catalog1.json',
          's3://stac-catalogs/abc/321/outputs/catalog2.json',
          's3://stac-catalogs/abc/321/outputs/catalog3.json',
          's3://stac-catalogs/abc/321/outputs/catalog4.json',
          's3://stac-catalogs/abc/321/outputs/catalog5.json',
          's3://stac-catalogs/abc/321/outputs/catalog6.json',
          's3://stac-catalogs/abc/321/outputs/catalog7.json',
          's3://stac-catalogs/abc/321/outputs/catalog8.json',
          's3://stac-catalogs/abc/321/outputs/catalog9.json',
          's3://stac-catalogs/abc/321/outputs/catalog10.json',
        ]);
      });
    });

    describe('when there is no batch-catalogs.json file associated with the WorkItem', async function () {
      describe('when there is just one catalog', async function () {
        before(async function () {
          const s3 = objectStoreForProtocol('s3');
          const catalogContent = JSON.stringify(dummyCatalog);
          const stacCatalogUrl = resolve(workItemWithOneCatalog, 'catalog.json');
          await s3.upload(catalogContent, stacCatalogUrl, null, 'application/json');
        });

        it('returns the url of the catalog.json file', async function () {
          const stacCatalogs = await _getStacCatalogs(workItemWithOneCatalog);
          expect(stacCatalogs).to.deep.equal(['s3://stac-catalogs/abc/789/outputs/catalog.json']);
        });
      });

      // This should never happen, but it's good to test the behavior
      describe('when there is more than one catalog', async function () {
        before(async function () {
          const s3 = objectStoreForProtocol('s3');
          const catalogContent = JSON.stringify(dummyCatalog);
          for (let i = 0; i < 11; i++) {
            const stacCatalogUrl = resolve(workItemWithMultipleCatalogsNoBatchFile, `catalog${i}.json`);
            await s3.upload(catalogContent, stacCatalogUrl, null, 'application/json');
          }
        });

        it('returns an array sorted by catalog index', async function () {
          const stacCatalogs = await _getStacCatalogs(workItemWithMultipleCatalogsNoBatchFile);
          expect(stacCatalogs).to.deep.equal([
            's3://stac-catalogs/abc/987/outputs/catalog0.json',
            's3://stac-catalogs/abc/987/outputs/catalog1.json',
            's3://stac-catalogs/abc/987/outputs/catalog2.json',
            's3://stac-catalogs/abc/987/outputs/catalog3.json',
            's3://stac-catalogs/abc/987/outputs/catalog4.json',
            's3://stac-catalogs/abc/987/outputs/catalog5.json',
            's3://stac-catalogs/abc/987/outputs/catalog6.json',
            's3://stac-catalogs/abc/987/outputs/catalog7.json',
            's3://stac-catalogs/abc/987/outputs/catalog8.json',
            's3://stac-catalogs/abc/987/outputs/catalog9.json',
            's3://stac-catalogs/abc/987/outputs/catalog10.json',
          ]);
        });
      });
    });
  });

  describe('uploadLogs', function () {
    describe('with text logs', function () {
      const itemRecord0: WorkItemRecord = {
        id: 0, jobID: '123', serviceID: '', sortIndex: 0,
        workflowStepIndex: 0, retryCount: 0, duration: 0, updatedAt: new Date(), createdAt: new Date(),
      };
      const itemRecord1: WorkItemRecord = {
        id: 1, jobID: '123', serviceID: '', sortIndex: 0,
        workflowStepIndex: 0, retryCount: 0, duration: 0, updatedAt: new Date(), createdAt: new Date(),
      };
      before(async function () {
        // One of the items will have its log file written to twice
        await uploadLogs(itemRecord0, ['the old logs']);
        itemRecord0.retryCount = 1; // simulate a retry
        await uploadLogs(itemRecord0, ['the new logs']);
        await uploadLogs(itemRecord1, ['the only logs']);
      });
      describe('when there is a logs file already associated with the WorkItem', async function () {
        it('appends the new logs to the old ones', async function () {
          const logsLocation0 = getItemLogsLocation(itemRecord0);
          const s3 = objectStoreForProtocol('s3');
          const logs = await s3.getObjectJson(logsLocation0);
          expect(logs).to.deep.equal([
            'Start of service execution (retryCount=0, id=0)',
            'the old logs',
            'Start of service execution (retryCount=1, id=0)',
            'the new logs',
          ]);
        });
      });
      describe('when there is no logs file associated with the WorkItem', async function () {
        it('writes the logs to a new file', async function () {
          const logsLocation1 = getItemLogsLocation(itemRecord1);
          const s3 = objectStoreForProtocol('s3');
          const logs = await s3.getObjectJson(logsLocation1);
          expect(logs).to.deep.equal([
            'Start of service execution (retryCount=0, id=1)',
            'the only logs',
          ]);
        });
      });
    });
    describe('with JSON logs', function () {
      const itemRecord0: WorkItemRecord = {
        id: 2, jobID: '123', serviceID: '', sortIndex: 0,
        workflowStepIndex: 0, retryCount: 0, duration: 0, updatedAt: new Date(), createdAt: new Date(),
      };
      const itemRecord1: WorkItemRecord = {
        id: 3, jobID: '123', serviceID: '', sortIndex: 0,
        workflowStepIndex: 0, retryCount: 0, duration: 0, updatedAt: new Date(), createdAt: new Date(),
      };
      before(async function () {
        // One of the items will have its log file written to twice
        await uploadLogs(itemRecord0, [{ message: 'the old logs' }]);
        itemRecord0.retryCount = 1; // simulate a retry
        await uploadLogs(itemRecord0, [{ message: 'the new logs' }]);

        await uploadLogs(itemRecord1, [{ message: 'the only logs' }]);
      });
      describe('when there is a logs file already associated with the WorkItem', async function () {
        it('appends the new logs to the old ones', async function () {
          const logsLocation0 = getItemLogsLocation(itemRecord0);
          const s3 = objectStoreForProtocol('s3');
          const logs = await s3.getObjectJson(logsLocation0);
          expect(logs).to.deep.equal([
            { message: 'Start of service execution (retryCount=0, id=2)' },
            { message: 'the old logs' },
            { message: 'Start of service execution (retryCount=1, id=2)' },
            { message: 'the new logs' },
          ]);
        });
      });
      describe('when there is no logs file associated with the WorkItem', async function () {
        it('writes the logs to a new file', async function () {
          const logsLocation1 = getItemLogsLocation(itemRecord1);
          const s3 = objectStoreForProtocol('s3');
          const logs = await s3.getObjectJson(logsLocation1);
          expect(logs).to.deep.equal([
            { message: 'Start of service execution (retryCount=0, id=3)' },
            { message: 'the only logs' },
          ]);
        });
      });
    });
  });

  describe('runQueryCmrFromPull', async function () {
    const workItem = new WorkItem({
      jobID: '123',
      serviceID: 'abc',
      workflowStepIndex: 0,
      scrollID: '1234',
      operation: { requestID: 'foo' },
      id: 1,
    });
    describe('when an error occurs', async function () {
      // https://axios-http.com/docs/res_schema
      let axiosStub;
      afterEach(function () {
        axiosStub.restore();
      });
      describe('and the server provides data', async function () {
        const description = 'Query CMR server failed unexpectedly';
        before(async function () {
          axiosStub = sinon.stub(axios, 'post').callsFake(
            async function () { throw { 'response': { 'data': { description } } }; });
        });
        it('returns an error message matching the description', async function () {
          const result = await serviceRunner.runQueryCmrFromPull(workItem);
          expect(result.error).to.equal(description);
        });
      });
      describe('and there is a status code', async function () {
        const status = 500;
        before(async function () {
          axiosStub = sinon.stub(axios, 'post').callsFake(
            async function () { throw { 'response': { status } }; });
        });
        it('returns an error message that includes the status code', async function () {
          const result = await serviceRunner.runQueryCmrFromPull(workItem);
          expect(result.error).to.equal(`The Query CMR service responded with status ${status}.`);
        });
      });
      describe('and there is status text', async function () {
        const statusText = 'Not Found';
        before(async function () {
          axiosStub = sinon.stub(axios, 'post').callsFake(
            async function () { throw { 'response': { statusText } }; });
        });
        it('returns an error message that includes the status text', async function () {
          const result = await serviceRunner.runQueryCmrFromPull(workItem);
          expect(result.error).to.equal(`The Query CMR service responded with status ${statusText}.`);
        });
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
        expect(result.error).to.equal('The harmonyservices/query-cmr:stable service failed.');
      });
    });

    describe('when geojson is passed as a string', async function () {
      const invocArgs = env.invocationArgs;
      const workItem = new WorkItem({
        jobID: '123',
        serviceID: 'abc',
        workflowStepIndex: 1,
        operation: {
          requestID: 'foo',
          subset: {
            shape: 'fake geojson',
          },
        },
        id: 1,
      });
      let execStub;
      before(async function () {
        env.invocationArgs = 'abc\n123';
        execStub = sinon.stub(k8s, 'Exec').callsFake(
          function () {
            return {
              exec: (): void => {},
            };
          });
        await serviceRunner.runServiceFromPull(workItem);
      });

      after(function () {
        execStub.restore();
        env.invocationArgs = invocArgs;
      });

      it('saves the geojson to the /tmp directory', async function () {
        const geoJSon = String(readFileSync('/tmp/shapefile.json'));
        expect(geoJSon).equals('fake geojson');
      });
      it('replaces the geojson string in the operation with the shape entry', async function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((workItem.operation as any).subset.shape.href).equals('file:///tmp/shapefile.json');
      });
    });
  });

  describe('LogStream', function () {

    const message = 'mv \'/tmp/tmpkwxpifmr/tmp-result.tif\' \'/tmp/tmpkwxpifmr/result.tif\'';
    const user = 'bo';
    const timestamp = '2022-10-06T17:04:21.090726Z';
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
  });
});
