/**
 * Converts the array of string items to a single textual string where elements are
 * comma-separated, and an "and" is inserted as necessary., e.g.
 * ['a'] => 'a'
 * ['a', 'b'] => 'b and c'
 * ['a', 'b', 'c'] => 'a, b, and c'
 *
 * Oxford commas are used.
 *
 * @param {Array<string>} items The items to be converted to text
 * @returns {string} The resulting textual string
 */
export function listToText(items: Array<string>): string {
  let result;
  if (!items) return '';
  switch (items.length) {
    case 0: return '';
    case 1: return items[0];
    case 2: return items.join(' and ');
    default:
      result = items.concat(); // Copies the array
      result[result.length - 1] = `and ${result[result.length - 1]}`;
  }
  return result.join(', ');
}

/**
 * Truncates a string to the specified number of characters. The last
 * three characters are replaced with '...'.
 *
 * @param {string} s The string to truncate
 * @param {integer} n The maximum number of characters to keep
 *
 * @returns {string} The truncated string
 */
export function truncateString(s: string, n: number): string {
  let truncatedString = s;
  if (s.length > n) {
    if (n < 3) {
      truncatedString = '...';
    } else {
      truncatedString = `${s.slice(0, n - 3)}...`;
    }
  }
  return truncatedString;
}
