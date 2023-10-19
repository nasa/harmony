import JobLink from '../models/job-link';
import { objectStoreForProtocol } from './object-store';
import { resolve } from './url';

/**
 * A link within a STAC item or catalog
 * https://github.com/radiantearth/stac-spec/blob/master/catalog-spec/catalog-spec.md#link-object
 * https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md#link-object
 */
export interface StacLink {
  rel: 'self' | 'root' | 'parent' | 'child' | 'item' | 'collection' | 'derived_from' | 'alternate' | string;
  href: string;
  type?: string;
  title?: string;
}

/**
 * An asset within a STAC item
 * https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md#asset-object
 */
export interface StacAsset {
  href: string;
  title?: string;
  description?: string;
  type?: string;
  roles?: ('thumbnail' | 'overview' | 'data' | 'metadata' | string)[];
}

/**
 * A STAC item
 * https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md
 */
export interface StacItem extends GeoJSON.Feature {
  stac_version: string;
  stac_extensions?: string[];
  id: string; // Required by STAC but not GeoJSON.Feature
  type: 'Feature';
  // geometry, bbox inherited from GeoJSON.Feature.  At least one of the two is required.
  // properties inherited from GeoJSON.Feature, required
  links: StacLink[];
  assets: { [name: string]: StacAsset };
  collection?: string;
}

/**
 * A STAC catalog
 * https://github.com/radiantearth/stac-spec/blob/master/catalog-spec/catalog-spec.md
 */
export interface StacCatalog {
  stac_version: string;

  stac_extensions?: string[];

  id: string;

  title?: string;

  description: string;

  links: StacLink[];
}

export interface StacItemLink {
  href: string;
  rel: string;
  type?: string;
  title?: string;
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
  const catalog = await s3.getObjectJson(catalogUrl) as StacCatalog;
  return catalog.links
    .filter((l) => l.rel === 'item')
    .map((l) => new URL(l.href, catalogUrl).href);
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

/**
 * Return the links to the data items from a STAC catalog. Note that for most of our
 * services the data items are under item.assets.data, but for Giovanni the links are
 * under item.assets['Giovanni URL']. However to make it more general we return any link
 * for an asset that includes the 'data' role in its list of roles.
 *
 * @param catalogItems - a list of STAC catalog items
 * @returns a list of URLs pointing to data (may include s3/http/https URLs)
 */
export function getCatalogLinks(catalogItems: StacItem[]): string[] {
  const links = [];
  for (const item of catalogItems) {
    if (item.assets) {
      for (const assetName in item.assets) {
        const asset = item.assets[assetName];
        if (assetName === 'data' || item.assets[assetName].roles?.includes('data')) {
          if (asset.href) {
            links.push(asset.href);
          }
        }
      }
    }
  }

  return links;
}