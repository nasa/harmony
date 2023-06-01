/**
 * The purpose of this file is to override any interaction with AWS
 * for tests. It is referenced in the .mocharc.yml file to ensure it
 * stubs out interactions for all tests before they begin.
 */
import { hookMockS3 } from './object-store';
import { RequestHandler } from 'express';
import multer from 'multer';
import * as tmp from 'tmp';
import env from '../../app/util/env';
import { stub } from 'sinon';
import * as shapefileUpload from '../../app/middleware/shapefile-upload';

hookMockS3();

/**
 * Override shapefile upload middleware code which uses S3 and multer
 * @returns middleware request handler that adds the shapefile handling
 */
function shapefileUploadMock(): RequestHandler {
  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => {
      const tempDir = tmp.dirSync().name;
      callback(null, tempDir);
    },
    filename: (_req, file, callback) => {
      callback(null, file.originalname);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fields: env.maxPostFields, // Maximum number of non-file fields to accept
      fileSize: env.maxPostFileSize, // Maximum size for shapefiles
      files: 1, // Maximum number of files to accept
      parts: env.maxPostFileParts, // Maximum number of multipart parts to accept
    },
  });

  return upload.single('shapefile');
}

stub(shapefileUpload, 'default').callsFake(() => shapefileUploadMock());