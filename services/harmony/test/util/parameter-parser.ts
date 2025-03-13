import { describe, it } from 'mocha';
import { expect } from 'chai';

import DataOperation from '../../app/models/data-operation';
import { validateBooleanField, handleForceAsync, handleIgnoreErrors, handlePixelSubset } from '../../app/util/parameter-parsers';
import { RequestValidationError } from '../../app/util/errors';
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

