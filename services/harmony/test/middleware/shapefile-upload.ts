import { expect } from 'chai';
import { Request, Response } from 'express';
import { describe, it } from 'mocha';
import multer from 'multer';

import { handleMulterErrors } from '../../app/middleware/shapefile-upload';
import env from '../../app/util/env';
import { RequestValidationError } from '../../app/util/errors';

/**
 * Calls the handleMulterErrors middleware with the given error
 *
 * @param err - The error to pass to the middleware
 * @returns The error the middleware passed to next
 */
function errorPassedToNext(err: Error): Error {
  let nextError: Error;
  handleMulterErrors(err, {} as Request, {} as Response, (e) => { nextError = e; });
  return nextError;
}

describe('handleMulterErrors', function () {
  const tests = [{
    code: 'LIMIT_FIELD_COUNT' as const,
    expectedMessage: `Too many form fields. Harmony accepts at most ${env.maxPostFields} non-file fields in a multipart/form-data request. `
      + 'To pass many values for a parameter such as variable or granuleId, send them as a single comma-separated value instead of repeating the field.',
  }, {
    code: 'LIMIT_PART_COUNT' as const,
    expectedMessage: `Too many form parts. Harmony accepts at most ${env.maxPostFileParts} parts in a multipart/form-data request. `
      + 'To pass many values for a parameter such as variable or granuleId, send them as a single comma-separated value instead of repeating the field.',
  }, {
    code: 'LIMIT_FILE_SIZE' as const,
    field: 'shapefile',
    expectedMessage: `Shapefile too large. The maximum shapefile size is ${env.maxPostFileSize} bytes.`,
  }, {
    code: 'LIMIT_UNEXPECTED_FILE' as const,
    field: 'notashapefile',
    expectedMessage: 'Invalid multipart/form-data request: Unexpected file field (field: notashapefile)',
  }, {
    code: 'LIMIT_FIELD_VALUE' as const,
    expectedMessage: 'Invalid multipart/form-data request: Field value too long',
  }];

  for (const { code, field, expectedMessage } of tests) {
    describe(`when multer raises a ${code} error`, function () {
      before(function () {
        this.error = errorPassedToNext(new multer.MulterError(code, field));
      });

      it('passes a RequestValidationError to the next middleware', function () {
        expect(this.error).to.be.an.instanceOf(RequestValidationError);
        expect(this.error.statusCode).to.equal(400);
      });

      it('uses an error message that explains the problem', function () {
        expect(this.error.message).to.equal(expectedMessage);
      });
    });
  }

  describe('when the error was not raised by multer', function () {
    it('passes the original error to the next middleware', function () {
      const err = new Error('something else went wrong');
      expect(errorPassedToNext(err)).to.equal(err);
    });
  });
});
