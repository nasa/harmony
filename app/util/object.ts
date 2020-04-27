/**
 * Converts all of the keys in the passed in object to lowercase strings.
 * @param {Object} object The object
 * @returns {any} The object passed in with all of the keys converted to lowercase strings
 */
export function keysToLowerCase(object: ObjectConstructor): any {
  if (object) {
    const updatedObject = {};
    for (const k of Object.keys(object)) {
      updatedObject[k.toLowerCase()] = object[k];
    }
    return updatedObject;
  }
  return null;
}
