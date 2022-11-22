import * as mustache from 'mustache';

//
// Helper functions for workflow-ui tests
//

/**
 * Render a navigation prev/next/first/last page link
 * @param path - the path portion of the url for the link
 * @param title - The title for the link
 * @param enabled - If true the link is enabled - defaults to true
 * @returns A string for the html for the link
 */
export function renderNavLink(
  path: String,
  title: String,
  enabled = true,
): String {
  const link = enabled ? 'http:&#x2F;&#x2F;127.0.0.1:4000{{path}}' : '';
  const template = `<a class="page-link" href="${link}" title="{{title}}">{{title}}</a>`;
  return mustache.render(template, { path, title });
}