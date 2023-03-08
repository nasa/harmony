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
import HarmonyRequest from '../models/harmony-request';
import { getServiceConfigs } from '../models/services/index';
import { getRequestRoot } from '../util/url';
import env from '../util/env';
import version from '../util/version';
import { promisify } from 'util';
import { ServiceCapabilities } from '../models/services/base-service';
import { servicesVersion } from 'typescript';

const readFile = promisify(fs.readFile);

let docsHtml;


/**
 * Generates an array of tokens that represent a table of the service's capabilities
 * @param md - MarkDownIt - the markdown parser
 * @param serviceCaps - the service capabilities object
 * @returns An array of tokens that will be used to render a table.
 */
function getServiceTable(md: MarkDownIt, serviceCaps: ServiceCapabilities): unknown[] {
  const { Token } = md.core.State.prototype;
  const tableTokens = [];

  const tableToken = new Token('table_open', 'table', 1);
  tableToken.attrPush(['class', 'service_table']);
  tableTokens.push(tableToken);

  // main header
  tableTokens.push(new Token('table_row_open', 'tr', 1));
  const titleHeader = new Token('table_header_open', 'th', 1);
  titleHeader.attrPush(['colspan', '7']);
  titleHeader.attrPush(['class', 'table_title']);
  tableTokens.push(titleHeader);
  let itemToken = new Token('inline', '', 0);
  itemToken.content = 'Capabilities';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'th', -1));
  tableTokens.push(new Token('table_row_close', 'tr', -1));

  // first sub header
  tableTokens.push(new Token('table_row_open', 'tr', 1));
  const subsettingHeader = new Token('table_header_open', 'th', 1);
  subsettingHeader.attrPush(['colspan', '4']);
  tableTokens.push(subsettingHeader);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'subsetting';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'th', -1));
  // concatenation header
  const concatenationHeader = new Token('table_header_open', 'th', 1);
  tableTokens.push(concatenationHeader);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'concatenation';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'th', -1));
  // reprojection header
  const reprojectionHeader = new Token('table_header_open', 'th', 1);
  tableTokens.push(reprojectionHeader);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'reprojection';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'th', -1));
  // formats header
  const formatsHeader = new Token('table_header_open', 'th', 1);
  tableTokens.push(formatsHeader);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'output formats';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'th', -1));
  tableTokens.push(new Token('table_row_close', 'tr', -1));

  tableTokens.push(new Token('table_row_open', 'tr', 1));
  // subsetting sub-header
  let headerToken = new Token('table_header_open', 'th', 1);
  headerToken.attrPush(['class', 'subheader']);
  tableTokens.push(headerToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'bounding box';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'td', -1));
  headerToken = new Token('table_header_open', 'th', 1);
  headerToken.attrPush(['class', 'subheader']);
  tableTokens.push(headerToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'shape';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'td', -1));
  headerToken = new Token('table_header_open', 'th', 1);
  headerToken.attrPush(['class', 'subheader']);
  tableTokens.push(headerToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'variable';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'td', -1));
  headerToken = new Token('table_header_open', 'th', 1);
  headerToken.attrPush(['class', 'subheader']);
  tableTokens.push(headerToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'multiple variable';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_header_close', 'td', -1));

  // non-subsetting values
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  let concatSetting = serviceCaps.concatenation ? 'Y' : 'N';
  if (serviceCaps.concatenate_by_default) {
    concatSetting = 'DEFAULT';
  }
  itemToken.content = concatSetting;
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = serviceCaps.output_formats?.join() || '';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));

  tableTokens.push(new Token('table_row_close', 'tr', -1));

  // subsetting values
  tableTokens.push(new Token('table_row_open', 'tr', 1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = serviceCaps.subsetting.bbox ? 'Y' : 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = serviceCaps.subsetting.shape ? 'Y' : 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = serviceCaps.subsetting.variable ? 'Y' : 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  tableTokens.push(new Token('table_data_open', 'td', 1));
  itemToken = new Token('inline', '', 0);
  itemToken.content = serviceCaps.subsetting.multiple_variable ? 'Y' : 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  // empty fill
  const fillerToken = new Token('table_data_open', 'td', 1);
  fillerToken.attrPush(['colspan', '3']);
  fillerToken.attrPush(['class', 'filler_data']);
  tableTokens.push(fillerToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = '';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));

  tableTokens.push(new Token('table_row_close', 'tr', -1));

  tableTokens.push(new Token('table_close', 'table', -1));

  return tableTokens;
}

/**
 * Finds the `{servicesInfo}` token in the markdown document, and replaces it with information for
 * all the services
 * @param md - the markdown parser
 * @param _options - This is the options object that is passed to the plugin.
 * @returns A function that takes a markdown instance and an options object.
 */
function generateServicesDocs(md: MarkDownIt, _options: Record<string, unknown>): void {
  md.core.ruler.push('build-service-table', function (state) {

    const { tokens } = state;
    if (!tokens) return;
    const { length } = tokens;
    const { Token } = md.core.State.prototype;
    const serviceTokens = [];

    for (const { name, capabilities } of getServiceConfigs()) {
      // serviceTokens.push(new Token('heading_open', 'h3', 1));
      // let inlineToken = new Token('inline', '', 0);
      // inlineToken.content = name;
      // inlineToken.type = 'text';
      // inlineToken.children = [];
      // serviceTokens.push(inlineToken);
      // serviceTokens.push(new Token('heading_close', 'h3', -1));
      serviceTokens.push(new Token('paragraph_open', 'p', 1));
      let spanToken = new Token('span_open', 'span', 1);
      spanToken.attrPush(['class', 'service_name']);
      serviceTokens.push(spanToken);
      let inlineToken = new Token('inline', '', 0);
      inlineToken.content = 'Name: ';
      inlineToken.type = 'text';
      inlineToken.children = [];
      inlineToken.attrPush(['class', 'service_name']);
      serviceTokens.push(inlineToken);
      serviceTokens.push(new Token('span_close', 'span', -1));
      inlineToken = new Token('inline', '', 0);
      inlineToken.content = name;
      inlineToken.type = 'text';
      inlineToken.children = [];
      serviceTokens.push(inlineToken);
      inlineToken = new Token('inline', 'br', 0);
      inlineToken.type = 'hardbreak';
      inlineToken.children = [];
      serviceTokens.push(inlineToken);
      spanToken = new Token('span_open', 'span', 1);
      spanToken.attrPush(['class', 'service_name']);
      serviceTokens.push(spanToken);
      inlineToken = new Token('inline', '', 0);
      inlineToken.content = 'Description:';
      inlineToken.type = 'text';
      inlineToken.children = [];
      serviceTokens.push(inlineToken);
      serviceTokens.push(new Token('span_close', 'span', -1));
      inlineToken = new Token('inline', 'br', 0);
      inlineToken.type = 'hardbreak';
      inlineToken.children = [];
      serviceTokens.push(inlineToken);
      inlineToken = new Token('inline', '', 0);
      inlineToken.content = 'DESCRIPTION';
      inlineToken.type = 'text';
      inlineToken.children = [];
      serviceTokens.push(inlineToken);
      serviceTokens.push(new Token('paragraph_close', 'p', -1));
      const tableTokens = getServiceTable(md, capabilities) as (typeof Token)[];
      serviceTokens.push(...tableTokens);
    }

    let markToken = null;
    for (let i = 0; i < length; i++) {
      if (tokens[i].type === 'paragraph_open') {
        const inlineToken = tokens[i + 1];
        if (inlineToken && inlineToken.children?.length === 1 && inlineToken.content === '{servicesInfo}') {
          markToken = [i, 3];
        }
      }
    }

    if (markToken) {
      tokens.splice(markToken[0], markToken[1], ...serviceTokens);
    }
  });
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
 * Express.js handler that returns the Harmony documentation page content.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 */
export default async function docsPage(req: HarmonyRequest, res: Response): Promise<void> {
  const root = getRequestRoot(req);
  if (!docsHtml) {
    let exampleCount = 1;
    let tableCount = 1;
    let edlHost = 'https://uat.urs.earthdata.nasa.gov/';
    if (root === 'https://harmony.earthdata.nasa.gov/') {
      edlHost = 'https://urs.earthdata.nasa.gov/';
    }
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
      // replace '{{root}}' with `root`
      .use(inline, 'root_replace', 'text', function (tokens, idx) {
        tokens[idx].content = markdownInterpolate(tokens[idx].content, {
          root: () => root,
          edl: () => edlHost.slice(10),
          exampleCounter: () => `${exampleCount++}`,
          tableCounter: () => `${tableCount++}`,
        });
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
      .use(generateServicesDocs, {})
      // Add support for importing markdown fragments into other markdown files
      .use(inc, {
        root: 'app/markdown/',
      });

    const markDown = (await readFile('./app/markdown/docs.md')).toString('utf-8');
    docsHtml = md.render(markDown);
  }

  // render the mustache templates + the rendered markdown
  res.render('docs', {
    root,
    edlUrl: env.oauthHost,
    version,
    docsHtml,
  });
}
