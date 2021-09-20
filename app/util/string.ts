export enum Conjunction {
  AND = 'and',
  OR = 'or',
}

/**
 * Converts the array of string items to a single textual string where elements are
 * comma-separated, and an "and" is inserted as necessary., e.g.
 * `['a'] => 'a'`
 * `['a', 'b'] => 'b and c'`
 * `['a', 'b', 'c'] => 'a, b, and c'`
 *
 * Oxford commas are used.
 *
 * @param items - The items to be converted to text
 * @returns The resulting textual string
 */
export function listToText(items: string[], joinWord = Conjunction.AND): string {
  let result;
  if (!items) return '';
  switch (items.length) {
    case 0: return '';
    case 1: return items[0];
    case 2: return items.join(` ${joinWord} `);
    default:
      result = items.concat(); // Copies the array
      result[result.length - 1] = `${joinWord} ${result[result.length - 1]}`;
  }
  return result.join(', ');
}

/**
 * Truncates a string to the specified number of characters. The last
 * three characters are replaced with '...'.
 *
 * @param s - The string to truncate
 * @param n - The maximum number of characters to keep
 *
 * @returns The truncated string
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

/**
 * Returns true if a string is an integer.
 * @param value - the value to check
 * @returns true if it is an integer and false otherwise
 */
export function isInteger(value: string): boolean {
  return /^-?\d+$/.test(value);
}

/**
 * Removes AWS account ECR information or *.earthdata.nasa.gov from image name
 * since we may not want to expose that information.
 *
 * @param text - The string to sanitize
 * @returns the sanitized image name
 */
export function sanitizeImage(image: string): string {
  return image
    .replace(/.*amazonaws.com\//, '')
    .replace(/.*earthdata.nasa.gov\//, '');
}

/**
 * Returns true if the image repository for the given image is ECR
 *
 * @param image - the full image string
 * @returns true if the image is in ECR and false otherwise
 */
export function inEcr(image: string): boolean {
  return /.*amazonaws.com\//.test(image);
}
