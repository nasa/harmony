/**
 * Ensures the given parameter is an array.  If it is undefined, null, or
 * an empty string, returns an empty array.  If it's a single non-array
 * value, returns an array with one item containing that value.  If it is
 * an array, returns it.
 *
 * @param value - the object to wrap
 * @returns an array-wrapped version of the input value
 */
export default function wrap<T>(value: T): T | T[] {
  if (value === null || typeof value === 'undefined' || value.toString() === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
