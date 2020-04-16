/**
 * Determine whether or not any of the given links contain the items necessary to generate STAC
 *
 * @param {Array<Object>} links The 'data' links from a serialized Job
 * @returns {boolean} True if a STAC catalog should be generated
 */
function needsStacLink(links) {
  if (!links) return false;
  return links.some((link) => link.bbox && link.temporal);
}

module.exports = {
  needsStacLink,
};
