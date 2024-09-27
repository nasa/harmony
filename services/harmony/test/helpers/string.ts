/**
 * Generate a random string of a given length
 *
 * @param length - the desired string length
 * @param skipCodes - optional code points to skip, e.g., 0x002C for comma
 * @returns a random string of the given length
 */
export function generateRandomString(length: number, skipCodes: number[] = []): string {
  let result = '';

  for (let i = 0; i < length; i++) {
    // Generate a random Unicode code point from 0 to 65535
    let randomCodePoint: number;
    do {
      randomCodePoint = Math.floor(Math.random() * 65536);
    } while (skipCodes.includes(randomCodePoint));

    result += String.fromCharCode(randomCodePoint);
  }

  return result;
}