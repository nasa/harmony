import MarkDownIt from 'markdown-it';

import { supportedApiVersions } from '../capabilities';

/**
 * Finds the `{{capabilitiesSchemaVersions}}` placeholder in the markdown document and replaces
 * it with a list of links to the JSON Schema for each supported collection capabilities API
 * version, generated from `supportedApiVersions` so the documentation can't drift out of sync
 * with the schemas actually registered in `app/frontends/capabilities.ts`.
 * @param md - the markdown parser
 * @param options - plugin options; `root` is the base URL to link the schema files against
 */
export function generateCapabilitiesSchemaLinks(md: MarkDownIt, options: { root: string }): void {
  md.core.ruler.push('build-capabilities-schema-links', (state) => {
    const { tokens } = state;
    if (!tokens) return;
    const { length } = tokens;
    const { Token } = md.core.State.prototype;

    const items = [...supportedApiVersions].reverse().map((apiVersion) => {
      const url = `${options.root}/schemas/collection-capabilities/v${apiVersion}/collection-capabilities-v${apiVersion}.json`;
      return `<li><a href="${url}">Version ${apiVersion}</a></li>`;
    }).join('\n');
    const listToken = new Token('html_block', '', 0);
    listToken.content = `<ul>\n${items}\n</ul>\n`;

    let markToken = null;
    for (let i = 0; i < length; i++) {
      if (tokens[i].type === 'paragraph_open') {
        const inlineToken = tokens[i + 1];
        if (inlineToken && inlineToken.children?.length === 1 && inlineToken.content === '{{capabilitiesSchemaVersions}}') {
          markToken = [i, 3];
        }
      }
    }

    if (markToken) {
      tokens.splice(markToken[0], markToken[1], listToken);
    }
  });
}
