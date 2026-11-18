import * as crypto from 'crypto';

import { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';

import env from '../util/env';
import { RequestValidationError } from '../util/errors';
import { S3ObjectStore } from '../util/object-store/s3-object-store';

const multiValueAdvice = 'To pass many values for a parameter such as variable or granuleId, send '
  + 'them as a single comma-separated value instead of repeating the field.';

/**
 * Returns an end user error message for an error raised by multer while parsing a
 * multipart/form-data request
 *
 * @param error - The error raised by multer
 * @returns The error message to return to the user
 */
function multerErrorMessage(error: multer.MulterError): string {
  switch (error.code) {
    case 'LIMIT_FIELD_COUNT':
      return `Too many form fields. Harmony accepts at most ${env.maxPostFields} non-file fields `
        + `in a multipart/form-data request. ${multiValueAdvice}`;
    case 'LIMIT_PART_COUNT':
      return `Too many form parts. Harmony accepts at most ${env.maxPostFileParts} parts `
        + `in a multipart/form-data request. ${multiValueAdvice}`;
    case 'LIMIT_FILE_SIZE':
      return `Shapefile too large. The maximum shapefile size is ${env.maxPostFileSize} bytes.`;
    default:
      return `Invalid multipart/form-data request: ${error.message}`
        + (error.field ? ` (field: ${error.field})` : '');
  }
}

/**
 * Error handling middleware that converts errors raised by multer, such as exceeding the
 * configured form field or part limits, into a RequestValidationError. Without this, multer
 * errors have no HTTP status code and are returned to the user as a 500 Internal server error.
 *
 * @param err - The error raised by a previous middleware
 * @param _req - The client request
 * @param _res - The client response
 * @param next - The next function in the middleware chain
 */
export const handleMulterErrors: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err instanceof multer.MulterError) {
    next(new RequestValidationError(multerErrorMessage(err)));
  } else {
    next(err);
  }
};

/**
 * Build a middleware for uploading shapefiles passed in with the request to S3
 *
 * @returns A middleware object that handles shapefile uploads
 */
export default function buildShapefileUploadMiddleware(): RequestHandler {
  const { uploadBucket } = env;
  const s3Store = new S3ObjectStore();
  const shapefilePrefix = 'temp-user-uploads';

  const upload = multer({
    storage: multerS3({
      s3: s3Store.s3,
      key: (_request, _file, callback) => {
        crypto.randomBytes(16, (err, raw) => {
          callback(err, err ? undefined : `${shapefilePrefix}/${raw.toString('hex')}`);
        });
      },
      bucket: uploadBucket,
    }),
    limits: {
      fields: env.maxPostFields, // Maximum number of non-file fields to accept
      fileSize: env.maxPostFileSize, // Maximum size for shapefiles
      files: 1, // Maximum number of files to accept
      parts: env.maxPostFileParts, // Maximum number of multipart parts to accept
    },
  });
  const uploadFields = [{ name: 'shapefile', maxCount: 1 }];
  return upload.fields(uploadFields);
}
