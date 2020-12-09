/**
 * Checks if the passed in string is a UUID
 *
 * @param s - The string to check
 * @returns Returns true if the string is a UUID and false otherwise.
 */
export default function isUUID(s: string): boolean {
  if (s && s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    return true;
  }
  return false;
}
