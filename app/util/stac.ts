import JobLink from '../models/job-link';
import { objectStoreForProtocol } from './object-store';
import { resolve } from './url';

export interface StacItemLink {
  href: string;
  rel: string;
  type?: string;
  title?: string;
}

export interface StacItem {
  assets: {
    data: StacItemLink;
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
 * Reads the STAC catalog and returns the urls of its STAC items
 *
 * @param catalogUrl - The catalog s3 url
 * @returns
 */
export async function getCatalogItemUrls(catalogUrl: string): Promise<string[]> {
  const s3 = objectStoreForProtocol('s3');
  const catalog = await s3.getObjectJson(catalogUrl);
  return catalog.links
    .filter((l) => l.rel === 'item')
    .map((l) => l.href);
}

/**
 * Reads the content of the catalog and returns the catalog items
 * @param catalogUrl - the catalog s3 url
 */
export async function readCatalogItems(catalogUrl: string): Promise<StacItem[]> {
  const s3 = objectStoreForProtocol('s3');
  const childLinks = await getCatalogItemUrls(catalogUrl);

  const items: StacItem[] = [];
  for (const link of childLinks) {
    const itemUrl = resolve(catalogUrl, link); // link has a relative path "./itemFile.json"
    const item = await s3.getObjectJson(itemUrl) as StacItem;
    items.push(item);
  }

  return items;
}
