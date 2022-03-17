/**
 * A link within a STAC item or catalog
 * https://github.com/radiantearth/stac-spec/blob/master/catalog-spec/catalog-spec.md#link-object
 * https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md#link-object
 */
export interface StacLink {
  rel: string;
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
  roles?: string[];
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
