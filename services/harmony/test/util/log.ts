/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { FilterRequest } from 'express-winston';
import { describe, it } from 'mocha';

import DataOperation from '../../app/models/data-operation';
import HarmonyRequest from '../../app/models/harmony-request';
import { requestFilter } from '../../app/server';
import { createLoggerForTest } from '../helpers/log';

describe('request logging filter', function () {
  it('returns a <redacted> cookie header, leaving other headers intact', function () {
    const filtReq: FilterRequest = { headers: { cookie: 'cookie-value', Host: 'host-value' } } as any as FilterRequest;
    const filtered = requestFilter(filtReq, 'headers');
    expect(filtered).to.deep.equal({ cookie: '<redacted>', Host: 'host-value' });
  });

  it('returns a <redacted> authorization header, leaving other headers intact', function () {
    const filtReq: FilterRequest = { headers: { authorization: 'auth-value', Host: 'host-value' } } as any as FilterRequest;
    const filtered = requestFilter(filtReq, 'headers');
    expect(filtered).to.deep.equal({ authorization: '<redacted>', Host: 'host-value' });
  });
  it('returns a <redacted> cookie-secret header, leaving other headers intact', function () {
    const filtReq: FilterRequest = { headers: { 'cookie-secret': 'secret-value', Host: 'host-value' } } as any as FilterRequest;
    const filtered = requestFilter(filtReq, 'headers');
    expect(filtered).to.deep.equal({ 'cookie-secret': '<redacted>', Host: 'host-value' });
  });
});

describe('axiosRedactor', function () {
  let testLogger, getTestLogs;

  beforeEach(function () {
    ({ getTestLogs, testLogger } = createLoggerForTest());
  });

  afterEach(function () {
    testLogger.close();
  });

  it('strips massive Axios objects and extracts metadata into axiosConfig and responseData', function () {
    const mockAxiosError = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      config: {
        url: 'https://uat.urs.earthdata.nasa.gov/oauth/tokens/user',
        method: 'post',
        timeout: 0,
        headers: { authorization: 'Bearer SECRET_TOKEN' },
      },
      response: {
        status: 403,
        data: { error: 'invalid_token', error_description: 'The token is malformed' },
        config: { headers: { authorization: 'Bearer SECRET_TOKEN' } },
        request: { some: 'circular_object' },
      },
      request: { some: 'circular_object' },
    };

    testLogger.error('Axios call failed', mockAxiosError);

    const logEntries = getTestLogs().split('\n').filter(l => l.trim() !== '');
    const lastEntry = JSON.parse(logEntries[logEntries.length - 1]);

    expect(lastEntry.axiosConfig).to.deep.equal({
      url: 'https://uat.urs.earthdata.nasa.gov/oauth/tokens/user',
      method: 'post',
      timeout: 0,
    });

    expect(lastEntry.responseData).to.deep.equal({
      error: 'invalid_token',
      error_description: 'The token is malformed',
    });

    expect(lastEntry).to.not.have.property('request');
    expect(lastEntry).to.not.have.property('response');
    expect(lastEntry).to.not.have.property('config');

    const rawLogString = getTestLogs();
    expect(rawLogString).to.not.include('SECRET_TOKEN');
  });

  it('does not modify the original Error object (Immutability Check)', function () {
    const originalError = {
      isAxiosError: true,
      config: { url: 'http://test.com' },
      response: { data: 'some-data' },
    };

    testLogger.error('Logging an error', originalError);

    expect(originalError.config).to.exist;
    expect(originalError.response).to.exist;
    expect(originalError.config.url).to.equal('http://test.com');
  });

  it('gracefully handles Axios errors that are missing a response (e.g., Network Error)', function () {
    const networkError = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Network Error',
      config: { url: 'http://unreachable.com', method: 'get' },
      // No response object here
    };

    testLogger.error('Connection failed', networkError);

    const logs = getTestLogs();
    expect(logs).to.include('"url":"http://unreachable.com"');
    expect(logs).to.not.include('"responseData"');
  });
});

describe('util/log', function () {
  describe('jsonLogger', function () {

    let testLogger, getTestLogs;
    beforeEach(function () {
      ({ getTestLogs, testLogger } = createLoggerForTest());
    });

    afterEach(function () {
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
      } as HarmonyRequest;
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
      } as HarmonyRequest;
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
