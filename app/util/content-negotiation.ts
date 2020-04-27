const anyWildcard = '*/*';
const defaultQuality = 1.0;
const qualityValueRegex = /^q=(.*)$/;

/**
 * Returns an array of mime-type objects in descending order of quality value
 * @param {String} acceptHeader The full accept header string value
 * @return {Array<Object>} an array of objects with two fields, mimeType (String) and
 *     qualityValue (Float);
 */
export function parseAcceptHeader(acceptHeader) {
  const values = acceptHeader.split(',').map((v) => v.trim());
  const mimeTypeMaps = values.map((v) => {
    const [mimeType, ...parameters] = v.split(';').map((p) => p.trim());
    const qvString = parameters.find((param) => param.match(qualityValueRegex));
    if (qvString) {
      const qvValue = parseFloat(qvString.match(qualityValueRegex)[1]);
      const qualityValue = Number.isNaN(qvValue) ? defaultQuality : qvValue;
      return { mimeType, qualityValue };
    }
    return { mimeType, qualityValue: defaultQuality };
  });
  // Order the mime-types such that the highest quality is first
  // and if there is a tie the first in the list is used
  return mimeTypeMaps.sort((a, b) => (b.qualityValue - a.qualityValue));
}

/**
 * Returns true if the mimeType provided is a match against the provided accept header
 * @param {String} mimeType The mime-type trying to match against
 * @param {String} acceptHeader The accept header
 * @return {Boolean} true if the mimeType is a match for the accept header and false otherwise
 */
export function isMimeTypeAccepted(mimeType, acceptHeader) {
  if (acceptHeader === anyWildcard) {
    return true;
  }
  const headerValue = acceptHeader
    .split(';')[0]
    .replace('*', '.*')
    .replace('/', '\\/');
  const re = new RegExp(`^${headerValue}$`);
  return !!mimeType.match(re);
}
