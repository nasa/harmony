import { promises as fs } from 'fs';
import { strict as assert } from 'assert';
import { v4 as uuid } from 'uuid';
import { StacLink, StacAsset, StacItem } from './types';

/**
 * Implementation of the StacCatalog type with constructor and write capabilities
 */
export default class Item implements StacItem {
  stac_version: string;

  stac_extensions?: string[];

  id: string; // Required by STAC but not GeoJSON.Feature

  type: 'Feature';

  geometry: GeoJSON.Geometry;

  bbox: GeoJSON.BBox;

  links: StacLink[];

  assets: { [name: string]: StacAsset };

  collection?: string;

  properties: GeoJSON.GeoJsonProperties;

  /**
   * Creates an item with the given properties
   * @param properties - non-default properties to set on the item.  Per the spec, either bbox or
   *   geometry is required
   */
  constructor(properties: Partial<StacItem>) {
    this.stac_version = '1.0.0-beta.2';
    this.stac_extensions = [];
    this.id = uuid();
    this.type = 'Feature';
    this.links = [];
    this.properties = {};
    Object.assign(this, properties);
    assert(!!this.bbox || !!this.geometry, 'Item bbox or geometry is required');
  }

  /**
   * Writes this item as JSON to the given filename
   * @param filename - the name of the file to write
   * @param pretty - whether to pretty-format the JSON
   */
  async write(filename: string, pretty = false): Promise<void> {
    const json = pretty ? JSON.stringify(this, null, 2) : JSON.stringify(this);
    return fs.writeFile(filename, json);
  }
}
