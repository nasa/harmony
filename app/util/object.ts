// Disable no-explicit-any for this file, since most methods will operate on objects generically
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Converts all of the keys in the passed in object to lowercase strings.
 * @param object - The object
 * @returns The object passed in with all of the keys converted to lowercase strings
 */
export function keysToLowerCase(object: Record<string, any>):
Record<string, any> {
  if (object) {
    const updatedObject = {};
    for (const k of Object.keys(object)) {
      updatedObject[k.toLowerCase()] = object[k];
    }
    return updatedObject;
  }
  return null;
}

/**
 * Removes any keys from an object with null or unknown values
 * @param object - the object
 * @returns The object passed in with all keys with null or unknown values removed
 */
export function removeEmptyProperties(object: Record<string, any>):
Record<string, any> {
  if (object) {
    const updatedObject = {};
    for (const k of Object.keys(object)) {
      if (object[k] !== null && object[k] !== undefined) {
        updatedObject[k] = object[k];
      }
    }
    return updatedObject;
  }
  return null;
}
