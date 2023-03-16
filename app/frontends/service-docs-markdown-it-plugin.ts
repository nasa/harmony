import MarkDownIt from 'markdown-it';
import { ServiceCapabilities } from '../models/services/base-service';
import { getServiceConfigs } from '../models/services/index';

/**
 * takes a markdown string and returns an array of tokens
 * @param markdown - The markdown string to be parsed.
 * @returns An array of tokens.
 */
function renderDescription(markdown: string): unknown[] {
  const md = new MarkDownIt(
    {
      html: true,
    },
  );
  return md.parse(markdown, {});
}

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
  itemToken = new Token('table_data_open', 'td', 1);
  itemToken.attrPush(['rowspan', '2']);
  tableTokens.push(itemToken);
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
  itemToken = new Token('table_data_open', 'td', 1);
  itemToken.attrPush(['rowspan', '2']);
  tableTokens.push(itemToken);
  itemToken = new Token('inline', '', 0);
  itemToken.content = 'N';
  itemToken.type = 'text';
  itemToken.children = [];
  tableTokens.push(itemToken);
  tableTokens.push(new Token('table_data_close', 'td', -1));
  itemToken = new Token('table_data_open', 'td', 1);
  itemToken.attrPush(['rowspan', '2']);
  tableTokens.push(itemToken);
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
export function generateServicesDocs(md: MarkDownIt, _options: Record<string, unknown>): void {
  md.core.ruler.push('build-service-table', function (state) {

    const { tokens } = state;
    if (!tokens) return;
    const { length } = tokens;
    const { Token } = md.core.State.prototype;
    const serviceTokens = [];

    for (const { name, description, capabilities } of getServiceConfigs()) {
      const containerToken = new Token('div_open', 'div', 1);
      containerToken.attrPush(['class', 'service_container']);
      serviceTokens.push(containerToken);
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

      let normalizedDescription = 'N/A';
      if (description) {
        // push headings down by two so that they become sub-headings of our section
        normalizedDescription = description.replaceAll(/(####|###|##|#)/g, (_a, b) => `##${b}`);
      }
      serviceTokens.push(...renderDescription(normalizedDescription));

      serviceTokens.push(new Token('paragraph_close', 'p', -1));
      const tableTokens = getServiceTable(md, capabilities) as (typeof Token)[];
      serviceTokens.push(...tableTokens);
      serviceTokens.push(new Token('div_close', 'div', -1));
    }

    let markToken = null;
    for (let i = 0; i < length; i++) {
      if (tokens[i].type === 'paragraph_open') {
        const inlineToken = tokens[i + 1];
        if (inlineToken && inlineToken.children?.length === 1 && inlineToken.content === '{{servicesInfo}}') {
          markToken = [i, 3];
        }
      }
    }

    if (markToken) {
      tokens.splice(markToken[0], markToken[1], ...serviceTokens);
    }
  });
}