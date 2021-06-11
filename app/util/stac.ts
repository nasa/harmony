import JobLink from '../models/job-link';

/**
 * Determine whether or not any of the given links contain the items necessary to generate STAC
 *
 * @param links - The 'data' links from a serialized Job
 * @returns True if a STAC catalog should be generated
 */
export function needsStacLink(links: Array<JobLink>): boolean {
  if (!links) return false;
  return links.some((link) => link.rel === 'data' && link.bbox && link.temporal);
}

/**
 * Return the subset of links that have STAC metadata elements `bbox` and `temporal`
 *
 * @param links - An array of link objects
 * @returns the subset of links that have STAC metadata
 */
export function linksWithStacData(links: Array<JobLink>): Array<JobLink> {
  return links.filter((link) => link.rel === 'data' && link.bbox && link.temporal);
}
