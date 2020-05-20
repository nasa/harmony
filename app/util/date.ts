/* eslint-disable import/prefer-default-export */
/**
 * Converts a Date object into an ISO String representation (truncates milliseconds)
 *
 * @param {Date} date The date to convert
 * @returns {string} An ISO string representation of the date, with milliseconds truncated
 */
export function toISODateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}/g, '');
}
