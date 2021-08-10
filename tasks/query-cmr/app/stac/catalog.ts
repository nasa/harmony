import * as fs from 'fs';
import { strict as assert } from 'assert';
import path from 'path';
import { v4 as uuid } from 'uuid';
import _ from 'lodash';
import StacItem from './item';
import { StacCatalog, StacLink } from './types';

/**
 * Implementation of the StacCatalog type with constructor, write function, and ability
 * to add children
 */
export default class Catalog implements StacCatalog {
  stac_version: string;

  stac_extensions?: string[];

  id: string;

  links: StacLink[];

  description: string;

  title?: string;

  children: (Catalog | StacItem)[];

  /**
   * Constructs a Catalog with the given properties.  At least description
   * is required
   * @param properties - the properties to set on the catalog (description is required)
   */
  constructor(properties: Partial<StacCatalog>) {
    this.stac_version = '1.0.0-beta.2';
    this.stac_extensions = [];
    this.id = uuid();
    this.links = [];
    this.children = [];
    Object.assign(this, properties);
    assert(!!this.description, 'Catalog description is required');
  }

  /**
   * Used in JSON serialization, returns an object that, when serialized
   * to JSON, is a valid StacCatalog.  Omits children.
   * @returns a JSON serializable representation of this catalog
   */
  toJSON(): StacCatalog {
    return _.omit(this, 'children') as unknown as StacCatalog;
  }

  /**
   * Writes this catalog and all of its children, with child filenames determined
   * by their relative link paths
   * @param filename - the filename to write this catalog to
   * @param pretty - if output JSON should be pretty-formatted
   */
  async write(filename: string, pretty = false): Promise<void> {
    const dirname = path.dirname(filename);
    const childLinks = this.links.filter((l) => l.rel === 'child' || l.rel === 'item');
    const promises = this.children.map(async (item, i) => {
      const itemFilename = path.join(dirname, childLinks[i].href);
      return item.write(itemFilename, pretty);
    });
    const json = pretty ? JSON.stringify(this, null, 2) : JSON.stringify(this);
    promises.push(fs.promises.writeFile(filename, json));
    await Promise.all(promises);
  }
}
