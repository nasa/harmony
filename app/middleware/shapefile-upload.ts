const multer = require('multer');
const multerS3 = require('multer-s3');
const crypto = require('crypto');
const env = require('../util/env');
const { objectStoreForProtocol } = require('../util/object-store');

/**
 * Build the middleware
 *
 * @returns {*} A middleware object that handles shapefile uploads
 */
function buildShapefileUploadMiddleware() {
  const { uploadBucket } = env;
  const objectStore = objectStoreForProtocol(env.objectStoreType);
  const shapefilePrefix = 'temp-user-uploads';

  const upload = multer({
    storage: multerS3({
      s3: objectStore.s3,
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

module.exports = buildShapefileUploadMiddleware;
