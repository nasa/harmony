import MarkDownIt from 'markdown-it';

/**
 * Takes a MarkDownIt instance and a dictionary of key/value pairs, and then replaces all instances
 * of the keys with their corresponding values
 * @param md - MarkDownIt - the markdown parser
 * @param options - mapping of keys to replacement values
 * @returns A function that takes a MarkDownIt instance and an options object.
 */
export function interpolate(md: MarkDownIt, options: Record<string, () => string>): void {
  md.core.ruler.push('interpolate-strings', function (state) {

    const { tokens } = state;
    if (!tokens) return;

    for (const token of tokens) {
      for (const key of Object.keys(options)) {
        token.content = token.content.replace(`{{${key}}}`, options[key]());
      }
    }
  });
}