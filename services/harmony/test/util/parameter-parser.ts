import { describe, it } from 'mocha';
import { expect } from 'chai';

import DataOperation from '../../app/models/data-operation';
import { handleForceAsync, handleIgnoreErrors, handlePixelSubset } from '../../app/util/parameter-parsers';
import { RequestValidationError } from '../../app/util/errors';
import { buildOperation } from '../helpers/data-operation';

describe('handleForceAsync', () => {
  let operation: DataOperation;

  beforeEach(() => {
    operation = buildOperation(undefined);
  });

  it('should not modify operation when query.forceasync is undefined', () => {
    handleForceAsync(operation, {});
    expect(operation.isSynchronous).to.be.undefined;
  });

  it('should set isSynchronous to false when query.forceasync is boolean true', () => {
    handleForceAsync(operation, { forceasync: true });
    expect(operation.isSynchronous).to.be.false;
  });

  it('should set isSynchronous to undefined when query.forceasync is boolean false', () => {
    handleForceAsync(operation, { forceasync: false });
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

  it('should throw RequestValidationError when query.forceasync is an invalid string', () => {
    expect(() => handleForceAsync(operation, { forceasync: 'invalid' })).to.throw(
      RequestValidationError, 'query parameter "forceAsync" must be either true or false');
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

  it('should set ignoreErrors to true when query.ignoreerrors is boolean true', () => {
    handleIgnoreErrors(operation, { ignoreerrors: true });
    expect(operation.ignoreErrors).to.be.true;
  });

  it('should set ignoreErrors to false when query.ignoreerrors is boolean false', () => {
    handleIgnoreErrors(operation, { ignoreerrors: false });
    expect(operation.ignoreErrors).to.be.false;
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

  it('should throw RequestValidationError when query.ignoreerrors is an invalid string', () => {
    expect(() => handleIgnoreErrors(operation, { ignoreerrors: 'invalid' })).to.throw(
      RequestValidationError, 'query parameter "ignoreErrors" must be either true or false');
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

  it('should set pixelSubset to true when query.pixelsubset is boolean true', () => {
    handlePixelSubset(operation, { pixelsubset: true });
    expect(operation.pixelSubset).to.be.true;
  });

  it('should set pixelSubset to false when query.pixelsubset is boolean false', () => {
    handlePixelSubset(operation, { pixelsubset: false });
    expect(operation.pixelSubset).to.be.false;
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

  it('should throw RequestValidationError when query.pixelsubset is an invalid string', () => {
    expect(() => handlePixelSubset(operation, { pixelsubset: 'invalid' })).to.throw(
      RequestValidationError, 'query parameter "pixelSubset" must be either true or false');
  });
});

