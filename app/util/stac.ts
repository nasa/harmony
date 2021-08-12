import * as fs from 'fs';
import path from 'path';
import JobLink from '../models/job-link';

export interface StacItem {
  assets: {
    data: {
      href: string;
      type: string;
      title: string;
    };
  };

  properties: {
    start_datetime: string;
    end_datetime: string;
  };

  bbox: [number, number, number, number];
}

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

/**
 * Reads the content of the catalog and returns the catalog items
 * @param filename - the catalog filename
 */
export function readCatalogItems(filename: string): StacItem[] {
  const dirname = path.dirname(filename);
  const catalog = JSON.parse(fs.readFileSync(filename, 'utf-8'));
  const childLinks = catalog.links
    .filter((l) => l.rel === 'item')
    .map((l) => l.href);

  const items: StacItem[] = [];
  for (const link of childLinks) {
    const location = `${dirname}/${link.replace('./', '/')}`;
    const item = JSON.parse(fs.readFileSync(location, 'utf-8')) as unknown as StacItem;
    items.push(item);
  }

  return items;
}
