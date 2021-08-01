import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Returns the MD5 checksum of an object store object. File contents are streamed and not held in
 * memory. Deletes the local file when done.
 *
 * @param store - an object store for interacting with the given protocol.
 * @param url - a URL specifying the location of an object in an object store.
 * @returns an MD5 checksum of an object store object as a string.
 */
export default async function fileCheckSum(fileName: string): Promise<string> {
  const md5sum = crypto.createHash('md5');
  const reader = fs.createReadStream(fileName);

  return new Promise((resolve, reject) => {
    reader.on('data', (data) => md5sum.update(data));
    reader.on('end', () => {
      const sum = md5sum.digest('hex');
      resolve(sum);
    });
    reader.on('error', (error) => {
      reject(error);
    });
  });
}
