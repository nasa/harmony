/**
 * Returns the parameter as parsed as an array of comma-separated values if
 * it was a string, or just returns the array if it's already parsed
 * @param value - The parameter value to parse (either an array or a string)
 */
export default function parseMultiValueParameter(value: string[] | string): string[] {
  if (value instanceof Array) {
    return value;
  }
  return value.split(',').map((v) => v.trim());
}
