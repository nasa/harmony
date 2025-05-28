import { Response } from 'express';
import * as fs from 'fs';
import hljs from 'highlight.js';
import MarkDownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import copy from 'markdown-it-copy';
import inline from 'markdown-it-for-inline';
import inc from 'markdown-it-include';
import mark from 'markdown-it-mark';
import replaceLink from 'markdown-it-replace-link';
import toc from 'markdown-it-toc-done-right';
import * as path from 'path';
import { promisify } from 'util';

import HarmonyRequest from '../../models/harmony-request';
import env from '../../util/env';
import { getRequestRoot } from '../../util/url';
import version from '../../util/version';
import { interpolate } from './interpolation-markdown-it-plugin';
import { generateServicesDocs } from './service-docs-markdown-it-plugin';

const readFile = promisify(fs.readFile);
const readDir = promisify(fs.readdir);

const MARKDOWN_DIR = './app/markdown';

const PROD_ROOT = 'https://harmony.earthdata.nasa.gov/';
const PROD_COLLECTION_ID = 'C1940472420-POCLOUD';
const UAT_COLLECTION_ID = 'C1234208438-POCLOUD';

// cached generated documentation html
let docsHtml;

/**
 * Clear the html cache
 */
export const clearCache = (): void => {
  docsHtml = null;
};

/**
 * read all the markdown files in the `markdown` directory, count the number of times the
 * `{{tableCounter}}` and `{{exampleCounter}}` placeholders appear, then return an object with the
 * counts.
 * NOTE: this is kind of over the top, but is needed for the automatic labeling of tables/examples
 * because they get rendered in reverse order (last-\>first). So we can't just increment counters
 * as we go, we need to decrement, which means we need to know what values to initialize the
 * counters with.
 * @returns An object with two properties: tableCount and exampleCount.
 */
async function getTableAndExampleCounts(): Promise<{ tableCount: number, exampleCount: number; }> {
  const markdownFiles = await readDir(MARKDOWN_DIR);
  let tableCount = 0;
  let exampleCount = 0;
  const tableRegex = /{{tableCounter}}/g;
  const exampleRegex = /{{exampleCounter}}/g;
  for (const filename of markdownFiles) {
    const markdown = (await readFile(path.join(MARKDOWN_DIR, filename))).toString('utf-8');
    const tableMatches = markdown.match(tableRegex);
    tableCount += tableMatches ? tableMatches.length : 0;
    const exampleMatches = markdown.match(exampleRegex);
    exampleCount += exampleMatches ? exampleMatches.length : 0;
  }

  return { tableCount, exampleCount };
}

/**
 * Replace `{{<key>}}` delineated values in markdown.
 * @param token - the markdown in which to replace the mappings. the strings to be replaced
 * should enclosed in double curly braces, e.g., `{{harmony_root}}`.
 * @param mappings - a map of strings to be replaced to values with which to replace them
 */
function markdownInterpolate(token: string, mappings: { [key: string]: () => string; }): string {
  const matches = token.match(/\{\{(.*?)\}\}/);
  if (!matches || matches.length < 2) return token;
  const valueFn = mappings[matches[1]];
  if (!valueFn) return token;
  return token.replaceAll(`{{${matches[1]}}}`, valueFn());
}

/**
 * reads the markdown files, parses them, and then renders them to HTML
 * @param root - The root of the URL for the environment.
 * @returns a promise that resolves to a string.
 */
export const generateDocumentation = async (root: string): Promise<string> => {
  let { tableCount, exampleCount } = await getTableAndExampleCounts();
  let exampleCollectionId = UAT_COLLECTION_ID;
  if (root === PROD_ROOT) {
    exampleCollectionId = PROD_COLLECTION_ID;
  }
  const edlHost = env.oauthHost;
  // markdown parser
  const md = new MarkDownIt(
    {
      html: true,
      linkify: true,
      highlight: function (str, lang): string {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return '<pre class="hljs"><code>' +
              hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
              '</code></pre>';
          } catch (__) { }
        }
        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
      },
    },
  )
    // interpolate some values into the inline tags
    .use(inline, 'root_replace', 'text', function (tokens, idx) {
      tokens[idx].content = markdownInterpolate(tokens[idx].content, {
        root: () => root,
        exampleCounter: () => `${exampleCount--}`,
        tableCounter: () => `${tableCount--}`,
        previewThreshold: () => `${env.previewThreshold}`,
      });
    })
    // interpolate values in non-inline tags
    .use(interpolate, {
      edl: () => edlHost.slice(8),
      exampleCollection: () => exampleCollectionId,
      root: () => root,
    })
    // add 'copy' button to code blocks
    .use(copy, {
      btnText: 'COPY',
      successText: 'COPIED',
      showCodeLanguage: true,
    })
    // replace edl or root links with proper value for the current environment
    .use(replaceLink, {
      processHTML: true,
      replaceLink: function (link: string, _env: string, _token: string, _htmlToken: string) {
        if (link === 'edl') {
          return edlHost;
        }
        if (link.includes('%7B%7Bedl%7D%7D')) {
          return link.replace('%7B%7Bedl%7D%7D', edlHost);
        }
        if (link.startsWith('%7B%7Broot%7D%7D')) {
          return link.replace('%7B%7Broot%7D%7D', root);
        }
        return link;
      },
    })
    // Add anchor tags to headers
    .use(anchor, {
      permalink: true,
      permalinkBefore: true,
      permalinkSymbol: '§',
    })
    // Add support for using '==<text>==' to mark up text
    .use(mark)
    .use(toc, {
      listType: 'ul',
      level: 2,
    })
    // Create the documentation for the services
    .use(generateServicesDocs, {})
    // Add support for importing markdown fragments into other markdown files
    .use(inc, {
      root: 'app/markdown/',
    });

  const markDown = (await readFile(path.join(MARKDOWN_DIR, 'docs.md'))).toString('utf-8');
  return md.render(markDown);
};

/**
 * Express.js handler that returns the Harmony documentation page content.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default async function docsPage(req: HarmonyRequest, res: Response): Promise<void> {
  const root = getRequestRoot(req);
  if (!docsHtml) {
    docsHtml = await generateDocumentation(root);
  }

  // render the mustache templates + the rendered markdown
  res.render('docs', {
    root,
    edlUrl: env.oauthHost,
    version,
    docsHtml,
  });

  // clear the stored html if `root` is a cloudfront url to work around an issue in production
  // where `root` is not initially set correctly to `harmony.earthdata.nasa.gov` (HARMONY-2012)
  if (root.includes('cloudfront')) {
    clearCache();
  }
}


