// Disable no-explicit-any for this file, since most methods will operate on objects generically
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Converts all of the keys in the passed in object to lowercase strings.
 * @param object - The object
 * @returns The object passed in with all of the keys converted to lowercase strings
 */
export default function keysToLowerCase(object: Record<string, any>):
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
