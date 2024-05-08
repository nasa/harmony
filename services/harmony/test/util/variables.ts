import { describe, it } from 'mocha';
import { expect } from 'chai';
import { validateVariables } from '../../app/util/variables';
import { RequestValidationError } from '../../app/util/errors';

describe('validateVariables', function () {
  it('should throw error if "all" is specified alongside other variables', function () {
    const variableIds = ['all', 'someVariable'];
    expect(() => validateVariables(variableIds, null)).to.throw(
      RequestValidationError,
      '"all" cannot be specified alongside other variables');
  });

  it('should throw error if "parameter_vars" is specified without variables', function () {
    const variableIds = ['parameter_vars'];
    expect(() => validateVariables(variableIds, null)).to.throw(
      RequestValidationError,
      '"parameter_vars" specified, but no variables given');
  });

  it('should throw error if "all" is specified alongside other variables in queryVars', function () {
    const variableIds = ['parameter_vars'];
    const queryVars = ['all', 'someVariable'];
    expect(() => validateVariables(variableIds, queryVars)).to.throw(
      RequestValidationError,
      '"all" cannot be specified alongside other variables');
  });

  it('should throw error if variables are passed in query parameters or request body without "parameter_vars" in url path', function () {
    const variableIds = [];
    const queryVars = 'someVariable';
    expect(() => validateVariables(variableIds, queryVars)).to.throw(
      RequestValidationError,
      '"parameter_vars" must be used in the url path when variables are passed in the query parameters or request body');
  });

  it('should not throw error if "all" is the only variable specified', function () {
    const variableIds = ['all'];
    expect(() => validateVariables(variableIds, null)).not.to.throw(RequestValidationError);
  });

  it('should not throw error if "parameter_vars" is specified with "all"', function () {
    const variableIds = ['parameter_vars'];
    const queryVars = ['all'];
    expect(() => validateVariables(variableIds, queryVars)).not.to.throw(RequestValidationError);
  });

  it('should not throw error if no variables are specified', function () {
    const variableIds = [];
    expect(() => validateVariables(variableIds, null)).not.to.throw(RequestValidationError);
  });

});
