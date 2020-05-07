/**
 * Converts all of the keys in the passed in object to lowercase strings.
 * @param {Object} object The object
 * @returns {Object} The object passed in with all of the keys converted to lowercase strings
 */
export default function keysToLowerCase(object: Record<string, any>): Record<string, any> {
  if (object) {
    const updatedObject = {};
    for (const k of Object.keys(object)) {
      updatedObject[k.toLowerCase()] = object[k];
    }
    return updatedObject;
  }
  return null;
}
