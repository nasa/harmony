import { FileStore } from './file-store';
import { ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';

/**
 * Returns the default object store for this instance of Harmony.  Allows requesting an
 * object store without first knowing a protocol.
 *
 * @returns the default object store for Harmony.
 */
export function defaultObjectStore(): ObjectStore {
  return new S3ObjectStore({});
}

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param protocol - the protocol used in object store URLs.  This may be a full URL, in
 *   which case the protocol will be read from the front of the URL.
 * @returns an object store for interacting with the given protocol
 */
export function objectStoreForProtocol(protocol?: string): ObjectStore {
  if (!protocol) {
    return null;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().split(':')[0];
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore({});
  } else if (normalizedProtocol === 'file') {
    return new FileStore();
  }
  return null;
}