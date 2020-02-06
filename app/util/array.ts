
/**
 * Ensures the given parameter is an array.  If it is undefined, null, or
 * an empty string, returns an empty array.  If it's a single non-array
 * value, returns an array with one item containing that value.  If it is
 * an array, returns it.
 *
 * @param {*} value the object to wrap
 * @returns {object[]} an array-wrapped version of the input value
 */
function wrap(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

module.exports = {
  wrap,
};
