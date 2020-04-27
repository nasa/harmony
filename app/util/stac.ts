/**
 * Determine whether or not any of the given links contain the items necessary to generate STAC
 *
 * @param {Array<Object>} links The 'data' links from a serialized Job
 * @returns {boolean} True if a STAC catalog should be generated
 */
export function needsStacLink(links) {
  if (!links) return false;
  return links.some((link) => link.rel === 'data' && link.bbox && link.temporal);
}

/**
 * Return the subset of links that have STAC metadata elements `bbox` and `temporal`
 *
 * @param {Array<Object>} links An array of link objects
 * @returns {Array<Object>} the subset of links that have STAC metadata
 */
export function linksWithStacData(links) {
  return links.filter((link) => link.rel === 'data' && link.bbox && link.temporal);
}
