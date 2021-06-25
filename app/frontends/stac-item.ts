import { v4 as uuid } from 'uuid';
import { pick } from 'lodash';
import { linksWithStacData } from 'util/stac';

import { Job } from 'models/job';
import JobLink from 'models/job-link';

export class HarmonyItem {
  id: string;

  stac_version: string;

  title: string;

  description: string;

  type: string;

  bbox: number[];

  geometry: {
    type?: string;
  };

  properties: {
    created?: string;
    datetime?: string;
  };

  assets: {};

  links: JobLink[];

  /**
   *
   * @param id - ID of the STAC Item
   * @param title - Title of the STAC Item
   * @param description - Description of the STAC Item
   * @param index - The index of this item in the STAC catalog
   */
  constructor(id: string = uuid(), title = '', description = '', index: number) {
    this.id = `${id}_${index}`;
    this.stac_version = '0.9.0';
    this.title = title;
    this.description = description;
    this.type = 'Feature';
    this.bbox = [];
    this.geometry = {};
    this.properties = {};
    this.assets = {};
    this.links = [];
  }

  /**
   * Adds GeoJSON Feature to the STAC Item
   * In future, this should take a polygon and derive a bounding box.
   *
   * @param bbox - GeoJSON bounding box
   */
  addSpatialExtent(bbox: number[]): void {
    // Validate bounding box; should compliant with GeoJSON spec
    if (bbox.length < 4) {
      throw new TypeError('Bounding box');
    }

    const west = bbox[0];
    const south = bbox[1];
    const east = bbox[2];
    const
      north = bbox[3];

    const geometry = {
      type: undefined,
      coordinates: [],
    };
    if (west > east) {
      // Case of bounding box crossing anti-meridian
      geometry.type = 'MultiPolygon';
      geometry.coordinates.push([
        [-180, south],
        [-180, north],
        [east, north],
        [east, south],
        [-180, south],
      ]);
      geometry.coordinates.push([
        [west, south],
        [west, north],
        [180, north],
        [180, south],
        [west, south],
      ]);
    } else {
      geometry.type = 'Polygon';
      geometry.coordinates.push([
        [west, south],
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ]);
    }
    this.bbox = bbox;
    this.geometry = geometry;
  }

  /**
   * Adds links to a STAC Item
   *
   * @param url - Link URL
   * @param relType - Relation type: [self, root, item]
   * @param title - Link title (human readable)
   *
   */
  addLink(url: string, relType: string, title: string): void {
    this.links.push(
      new JobLink({
        href: url,
        rel: relType,
        title,
      }),
    );
  }

  /**
   * Adds temporal properties for a STAC Item
   *
   * @param start - Data start datetime
   * @param end - Data end datetime
   *
   */
  addTemporalExtent(start: Date | string, end: Date | string): void {
    const startString = typeof start === 'string' ? start : start.toISOString();
    const endString = typeof end === 'string' ? end : end.toISOString();

    this.setProperty('start_datetime', startString);
    this.setProperty('end_datetime', endString);
    this.setProperty('datetime', startString);
  }

  /**
   * Sets a property for a STAC Item
   * @param name - Name of the property
   * @param value - Value of the property
   *
   */
  setProperty(name: string, value: string): void {
    this.properties[name] = value;
  }

  /**
   *
   * Adds an asset to the STAC Item
   *
   * @param href - Asset URL
   * @param title - Asset title
   * @param mimetype - Asset mimetype
   * @param role - Asset role [thumbnail,overview,data,metadata]
   *
   */
  addAsset(href: string, title: string, mimetype: string): void {
    let role = 'data';
    // Determine the role based on mimetype
    const [type, subtype] = mimetype.split('/');
    if (type === 'application') {
      if (subtype === 'json') {
        // application/json
        role = 'metadata';
      } else {
        // application/nc, application/octet-stream ...
        role = 'data';
      }
    } else if (type === 'image') {
      // image/*
      role = 'overview';
    } else if (type === 'text') {
      if (subtype === 'xml') {
        // text/xml
        role = 'metadata';
      } else {
        // text/plain, text/csv, ...
        role = 'data';
      }
    }

    // Using href as the key for assets; STAC clients seem to attach special meaning
    // to some keys (ex: thumbnail)
    this.assets[href] = {
      href,
      title,
      type: mimetype,
      roles: [role],
    };
  }

  /**
   * Placeholder method to support custom stringification
   *
   * @returns - STAC item JSON
   */
  toJSON(): object {
    const paths = ['id', 'stac_version', 'title', 'description', 'type', 'bbox', 'geometry', 'properties', 'assets', 'links'];
    return pick(this, paths);
  }
}

/**
 * Function to create a STAC item
 *
 * @param job - Harmony Job object
 * @param index - Index of the Link item in Job
 *
 * @returns STAC Item JSON
 */
export default function create(job: Job, index: number, linkType?: string): HarmonyItem {
  const title = `Harmony output #${index} in job ${job.jobID}`;
  const description = `Harmony out for ${job.request}`;
  const item = new HarmonyItem(job.jobID, title, description, index);

  // Set creation time
  const creationTime = Object.hasOwnProperty.call(job, 'createdAt') ? new Date(job.createdAt) : new Date();
  item.setProperty('created', creationTime.toISOString());
  // TBD: may be it should be a metadata for a Harmony service
  item.setProperty('license', 'various');
  // Add assets
  if (!job.links.length) {
    // job should have been loaded with the single requested link
    throw new RangeError('Error: STAC item index is out of bounds');
  }
  const {
    bbox,
    temporal,
    href,
    title: linkTitle,
    type,
  } = job.links[0];
  item.addSpatialExtent(bbox);
  item.addTemporalExtent(temporal.start, temporal.end);
  item.addAsset(href, linkTitle, type);
  // Add linkType to links if defined and not null
  const selfUrl = linkType ? `./?linkType=${linkType}` : '.';
  const parentUrl = linkType ? `../?linkType=${linkType}` : '../';

  item.addLink(selfUrl, 'self', 'self');
  item.addLink(parentUrl, 'root', 'parent');
  return item;
}
