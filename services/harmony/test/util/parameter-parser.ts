import { expect } from 'chai';
import { describe, it } from 'mocha';

import DataOperation from '../../app/models/data-operation';
import HarmonyRequest from '../../app/models/harmony-request';
import { RequestValidationError } from '../../app/util/errors';
import {
  handleForceAsync, handleFormat, handleIgnoreErrors, handlePixelSubset, validateBooleanField,
} from '../../app/util/parameter-parsers';
import { buildOperation } from '../helpers/data-operation';

describe('validateBooleanField', () => {
  it('should not throw an error for "true" string', () => {
    expect(() => validateBooleanField('testField', 'true')).to.not.throw();
  });

  it('should not throw an error for "false" string', () => {
    expect(() => validateBooleanField('testField', 'false')).to.not.throw();
  });

  it('should not throw an error for mixed case "TrUe" string', () => {
    expect(() => validateBooleanField('testField', 'TrUe')).to.not.throw();
  });

  it('should not throw an error for mixed case "FaLsE" string', () => {
    expect(() => validateBooleanField('testField', 'FaLsE')).to.not.throw();
  });

  it('should throw RequestValidationError for invalid string', () => {
    expect(() => validateBooleanField('testField', 'invalid')).to.throw(RequestValidationError, 'query parameter "testField" must be either true or false');
  });

  it('should throw RequestValidationError for numbers', () => {
    expect(() => validateBooleanField('testField', 123 as unknown as string)).to.throw(RequestValidationError, 'query parameter "testField" must be either true or false');
  });

  it('should throw RequestValidationError for empty string', () => {
    expect(() => validateBooleanField('testField', '')).to.throw(RequestValidationError, 'query parameter "testField" must be either true or false');
  });

  it('should not throw an error if value is undefined', () => {
    expect(() => validateBooleanField('testField', undefined as unknown as string)).to.not.throw();
  });
});

describe('handleForceAsync', () => {
  let operation: DataOperation;

  beforeEach(() => {
    operation = buildOperation(undefined);
  });

  it('should not modify operation when query.forceasync is undefined', () => {
    handleForceAsync(operation, {});
    expect(operation.isSynchronous).to.be.undefined;
  });

  it('should set isSynchronous to false when query.forceasync is string "true"', () => {
    handleForceAsync(operation, { forceasync: 'true' });
    expect(operation.isSynchronous).to.be.false;
  });

  it('should set isSynchronous to undefined when query.forceasync is string "false"', () => {
    handleForceAsync(operation, { forceasync: 'false' });
    expect(operation.isSynchronous).to.be.undefined;
  });

  it('should set isSynchronous to false when query.forceasync is mixed case "TrUe"', () => {
    handleForceAsync(operation, { forceasync: 'TrUe' });
    expect(operation.isSynchronous).to.be.false;
  });

  it('should set isSynchronous to undefined when query.forceasync is mixed case "FaLsE"', () => {
    handleForceAsync(operation, { forceasync: 'FaLsE' });
    expect(operation.isSynchronous).to.be.undefined;
  });
});

describe('handleIgnoreErrors', () => {
  let operation: DataOperation;

  beforeEach(() => {
    operation = buildOperation(undefined);
  });

  it('should set ignoreErrors to true when query.ignoreerrors is undefined', () => {
    handleIgnoreErrors(operation, {});
    expect(operation.ignoreErrors).to.be.true;
  });

  it('should set ignoreErrors to true when query.ignoreerrors is string "true"', () => {
    handleIgnoreErrors(operation, { ignoreerrors: 'true' });
    expect(operation.ignoreErrors).to.be.true;
  });

  it('should set ignoreErrors to false when query.ignoreerrors is string "false"', () => {
    handleIgnoreErrors(operation, { ignoreerrors: 'false' });
    expect(operation.ignoreErrors).to.be.false;
  });

  it('should set ignoreErrors to true when query.ignoreerrors is mixed case "TrUe"', () => {
    handleIgnoreErrors(operation, { ignoreerrors: 'TrUe' });
    expect(operation.ignoreErrors).to.be.true;
  });

  it('should set ignoreErrors to false when query.ignoreerrors is mixed case "FaLsE"', () => {
    handleIgnoreErrors(operation, { ignoreerrors: 'FaLsE' });
    expect(operation.ignoreErrors).to.be.false;
  });

});

describe('handlePixelSubset', () => {
  let operation: DataOperation;

  beforeEach(() => {
    operation = buildOperation(undefined);
  });

  it('should not modify operation when query.pixelsubset is undefined', () => {
    handlePixelSubset(operation, {});
    expect(operation.pixelSubset).to.be.undefined;
  });

  it('should set pixelSubset to true when query.pixelsubset is string "true"', () => {
    handlePixelSubset(operation, { pixelsubset: 'true' });
    expect(operation.pixelSubset).to.be.true;
  });

  it('should set pixelSubset to false when query.pixelsubset is string "false"', () => {
    handlePixelSubset(operation, { pixelsubset: 'false' });
    expect(operation.pixelSubset).to.be.false;
  });

  it('should set pixelSubset to true when query.pixelsubset is mixed case "TrUe"', () => {
    handlePixelSubset(operation, { pixelsubset: 'TrUe' });
    expect(operation.pixelSubset).to.be.true;
  });

  it('should set pixelSubset to false when query.pixelsubset is mixed case "FaLsE"', () => {
    handlePixelSubset(operation, { pixelsubset: 'FaLsE' });
    expect(operation.pixelSubset).to.be.false;
  });
});

describe('handleFormat', function () {
  let operation: DataOperation;
  let req: HarmonyRequest;

  beforeEach(function () {
    operation = buildOperation(undefined);
    req = { headers: {}, context: {} } as HarmonyRequest;
  });

  describe('when a format string is provided', function () {
    describe('sanitization', function () {
      it('strips spaces', function () {
        handleFormat(operation, 'application/netcdf; profile=opendap_url', req);
        expect(operation.outputFormat).to.equal('application/netcdf;profile=opendap_url');
      });

      it('strips double quotes', function () {
        handleFormat(operation, 'application/netcdf;profile="opendap_url"', req);
        expect(operation.outputFormat).to.equal('application/netcdf;profile=opendap_url');
      });

      it('strips single quotes', function () {
        handleFormat(operation, "application/netcdf;profile='opendap_url'", req);
        expect(operation.outputFormat).to.equal('application/netcdf;profile=opendap_url');
      });

      it('lowercases the format', function () {
        handleFormat(operation, 'IMAGE/PNG', req);
        expect(operation.outputFormat).to.equal('image/png');
      });

      it('handles quotes in profile parameters', function () {
        handleFormat(operation, 'application/x-netcdf4;profile="opendap_url"', req);
        expect(operation.outputFormat).to.equal('application/x-netcdf4;profile=opendap_url');
      });
    });

    describe('mime type aliases', function () {
      it('maps application/x-netcdf to application/netcdf', function () {
        handleFormat(operation, 'application/x-netcdf', req);
        expect(operation.outputFormat).to.equal('application/netcdf');
      });

      it('maps application/x-netcdf4 to application/netcdf', function () {
        handleFormat(operation, 'application/x-netcdf4', req);
        expect(operation.outputFormat).to.equal('application/netcdf');
      });

      it('maps application/netcdf4 to application/netcdf', function () {
        handleFormat(operation, 'application/netcdf4', req);
        expect(operation.outputFormat).to.equal('application/netcdf');
      });

      it('applies alias mapping case insensitively', function () {
        handleFormat(operation, 'APPLICATION/X-NETCDF4', req);
        expect(operation.outputFormat).to.equal('application/netcdf');
      });
    });

    describe('harmony UMM-S name mapping', function () {
      it('maps NETCDF-4 to application/netcdf', function () {
        handleFormat(operation, 'NETCDF-4', req);
        expect(operation.outputFormat).to.equal('application/netcdf');
      });

      it('maps HDF-EOS2 to application/x-hdf', function () {
        handleFormat(operation, 'HDF-EOS2', req);
        expect(operation.outputFormat).to.equal('application/x-hdf');
      });

      it('maps ZARR to application/x-zarr', function () {
        handleFormat(operation, 'ZARR', req);
        expect(operation.outputFormat).to.equal('application/x-zarr');
      });

      it('maps GIF to image/gif', function () {
        handleFormat(operation, 'GIF', req);
        expect(operation.outputFormat).to.equal('image/gif');
      });

      it('maps JPEG to image/jpeg', function () {
        handleFormat(operation, 'JPEG', req);
        expect(operation.outputFormat).to.equal('image/jpeg');
      });

      it('maps PNG to image/png', function () {
        handleFormat(operation, 'PNG', req);
        expect(operation.outputFormat).to.equal('image/png');
      });

      it('maps GEOTIFF to image/tiff', function () {
        handleFormat(operation, 'GEOTIFF', req);
        expect(operation.outputFormat).to.equal('image/tiff');
      });

      it('maps CSV to text/csv', function () {
        handleFormat(operation, 'CSV', req);
        expect(operation.outputFormat).to.equal('text/csv');
      });

      it('maps NETCDF-4 (OPeNDAP URL) to application/x-netcdf4;profile=opendap_url', function () {
        handleFormat(operation, 'NETCDF-4 (OPeNDAP URL)', req);
        expect(operation.outputFormat).to.equal('application/x-netcdf4;profile=opendap_url');
      });
    });

    describe('unknown formats', function () {
      it('passes through unrecognized mime types as-is (lowercased)', function () {
        handleFormat(operation, 'application/X-UNKNOWN', req);
        expect(operation.outputFormat).to.equal('application/x-unknown');
      });
    });

    it('does not set req.context.requestedMimeTypes', function () {
      handleFormat(operation, 'image/png', req);
      expect(req.context.requestedMimeTypes).to.be.undefined;
    });
  });

  describe('when no format string is provided', function () {
    it('does not set operation.outputFormat', function () {
      handleFormat(operation, null, req);
      expect(operation.outputFormat).to.be.undefined;
    });

    describe('when an Accept header is present', function () {
      it('does not set operation.outputFormat', function () {
        handleFormat(operation, null, req);
        expect(operation.outputFormat).to.be.undefined;
      });

      it('sets requestedMimeTypes from the accept header', function () {
        req.headers.accept = 'image/png, text/csv';
        handleFormat(operation, null, req);
        expect(req.context.requestedMimeTypes).to.deep.equal(['image/png', 'text/csv']);
      });

      it('filters out empty mime types', function () {
        req.headers.accept = 'image/png, ';
        handleFormat(operation, null, req);
        expect(req.context.requestedMimeTypes).to.not.include('');
      });
    });

    describe('when no Accept header is present', function () {
      it('does not set requestedMimeTypes', function () {
        handleFormat(operation, null, req);
        expect(req.context.requestedMimeTypes).to.be.undefined;
      });

      it('does not set operation.outputFormat', function () {
        handleFormat(operation, null, req);
        expect(operation.outputFormat).to.be.undefined;
      });
    });
  });
});

