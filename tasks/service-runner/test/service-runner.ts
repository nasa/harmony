import { expect } from 'chai';
import { describe, it } from 'mocha';
import env from '../app/util/env';
import WorkItem from '../../../app/models/work-item';
import * as serviceRunner from '../app/service/service-runner';

const { _getErrorMessage, _getStacCatalogs } = serviceRunner.exportedForTesting;

const errorLog = `
{
  "application": "cmr-granule-locator",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "found granules",
  "level": "info",
  "timestamp": "2021-09-13T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
{
  "application": "cmr-granule-locator",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "bad stuff",
  "level": "error",
  "timestamp": "2021-09-14T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
{
  "application": "cmr-granule-locator",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "second error",
  "level": "error",
  "timestamp": "2021-09-14T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
`;

const nonErrorLog = `
{
  "application": "cmr-granule-locator",
  "requestId": "c76c7a30-84a1-40a1-88a0-34a35e47fe8f",
  "message": "found granules",
  "level": "info",
  "timestamp": "2021-09-13T15:08:57.346Z",
  "env_name": "harmony-unknown"
}
`;

const emptyLog = '';

describe('Service Runner', function () {
  describe('_getErrorMessage()', function () {
    describe('when the error log has ERROR level entries', function () {
      const errorMessage = _getErrorMessage(errorLog);
      it('returns the first error log entry', function () {
        expect(errorMessage).equal('bad stuff');
      });
    });
    describe('when the error log has no ERROR level entries', function () {
      const errorMessage = _getErrorMessage(nonErrorLog);
      it('returns "unknown error"', function () {
        expect(errorMessage).equal('Unknown error');
      });
    });
    describe('when the error log is empty', function () {
      const errorMessage = _getErrorMessage(emptyLog);
      it('returns "unknown error"', function () {
        expect(errorMessage).equal('Unknown error');
      });
    });
    describe('when the error log is null', function () {
      const errorMessage = _getErrorMessage(null);
      it('returns "unknown error"', function () {
        expect(errorMessage).equal('Unknown error');
      });
    });
  });

  describe('_getStacCatalogs', function () {
    describe('when the directory has catalogs', function () {
      const files = _getStacCatalogs('test/fixtures/stac-catalogs');
      it('returns the list of catalogs', function () {
        expect(files).to.eql(['test/fixtures/stac-catalogs/catalog0.json']);
      });
    });

    describe('when the directory has no catalogs', function () {
      const files = _getStacCatalogs('test/fixtures/empty-dir');
      it('returns any empty list', function () {
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

  describe('runPythonServiceFromPull', async function () {
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
        const result = await serviceRunner.runPythonServiceFromPull(workItem);
        expect(result.error).to.be.not.empty;
      });
    });
  });
});
