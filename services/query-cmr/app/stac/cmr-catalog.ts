import _ from 'lodash';
import path from 'path';
import { Logger } from 'winston';

import { CmrUmmGranule } from '../../../harmony/app/util/cmr';
import { computeUmmMbr } from '../../../harmony/app/util/spatial/mbr';
import StacCatalog from './catalog';
import StacItem from './item';

/**
 * Creates a GeoJSON geometry given a GeoJSON BBox, accounting for antimeridian
 *
 * @param bbox - the bounding box to create a geometry from
 * @returns a Polygon or MultiPolygon representation of the input bbox
 */
export function bboxToGeometry(bbox: GeoJSON.BBox): GeoJSON.Geometry {
  const [west, south, east, north] = bbox;
  if (west > east) {
    return {
      type: 'MultiPolygon',
      coordinates: [
        [[
          [-180, south],
          [-180, north],
          [east, north],
          [east, south],
          [-180, south],
        ]],
        [[
          [west, south],
          [west, north],
          [180, north],
          [180, south],
          [west, south],
        ]],
      ],
    };
  }
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ]],
  };
}

/**
 * Implementation of StacCatalog that can obtain its children from CMR atom results
 */
export default class CmrStacCatalog extends StacCatalog {
  /**
   * Adds the given CMR UMM granules as child items of this catalog
   * @param granules - the UMM granules to add
   * @param pathPrefix - the prefix to use for href values on the link.  The link href will be
   *   the path prefix followed by the padded index of the granule plus .json
   * @param granuleLogger - The logger to use for logging messages
   * @param includeOpendapLinks - if true include OPeNDAP links in the catalog
   */
  addCmrUmmGranules(
    granules: CmrUmmGranule[],
    pathPrefix: string,
    granuleLogger: Logger,
    includeOpendapLinks: boolean,
  ): void {
    for (let i = 0; i < granules.length; i++) {
      const granule = granules[i];
      const bbox = computeUmmMbr(granule.umm.SpatialExtent?.HorizontalSpatialDomain?.Geometry) || [-180, -90, 180, 90];
      const geometry = bboxToGeometry(bbox);

      let startDateTime = granule.umm.TemporalExtent?.SingleDateTime;
      let endDateTime = granule.umm.TemporalExtent?.SingleDateTime;
      if (granule.umm.TemporalExtent?.RangeDateTime?.BeginningDateTime) {
        startDateTime = granule.umm.TemporalExtent.RangeDateTime.BeginningDateTime;
        endDateTime = granule.umm.TemporalExtent.RangeDateTime.EndingDateTime;
      }

      const isOpenDapLink = (l): boolean => (l.Description && (l.Description.toLowerCase().indexOf('opendap') !== -1))
        || (l.URL.toLowerCase().indexOf('opendap') !== -1);
      const isBrowseLink = (l): boolean => (l.Type === 'GET DATA' && l.Subtype === 'BROWSE IMAGE SOURCE');

      const links = (granule.umm.RelatedUrls || []).filter((g) =>
        (g.Type === 'GET DATA' || (g.Type === 'USE SERVICE API' && isOpenDapLink(g))));
      const [opendapLinks, dataBrowseLinks] = _.partition(links, (l) => isOpenDapLink(l));
      const [browseLinks, dataLinks] = _.partition(dataBrowseLinks, (l) => isBrowseLink(l));

      // Give the first data link the title 'data' and suffix subsequent ones with their index
      const dataAssets = dataLinks.map((link, j) => ([
        `data${j === 0 ? '' : j}`,
        {
          href: link.URL,
          title: path.basename(link.URL),
          description: link.Description,
          type: link.MimeType,
          roles: ['data'],
        },
      ]));
      const opendapAssets = opendapLinks.map((link, j) => ([
        `opendap${j === 0 ? '' : j}`,
        {
          href: link.URL,
          title: path.basename(link.URL),
          description: link.Description,
          type: link.MimeType,
          roles: ['data', 'opendap'],
        },
      ]));
      const browseAssets = browseLinks.map((link, j) => ([
        `browse${j === 0 ? '' : j}`,
        {
          href: link.URL,
          title: path.basename(link.URL),
          description: link.Description,
          type: link.MimeType,
          roles: ['visual'],
        },
      ]));

      const assets = includeOpendapLinks ?
        _.fromPairs(dataAssets.concat(opendapAssets).concat(browseAssets)) :
        _.fromPairs(dataAssets.concat(browseAssets));

      if (Object.keys(assets).length === 0) {
        granuleLogger.warn(`Granule ${granule.meta['concept-id']} had no data links and will be excluded from results`);
      } else {
        const item = new StacItem({
          bbox,
          geometry,
          assets,
          properties: {
            start_datetime: startDateTime,
            end_datetime: endDateTime,
            datetime: startDateTime,
          },
        });
        this.children.push(item);

        const indexStr = `${i}`.padStart(7, '0');
        this.links.push({
          rel: 'item',
          href: `${pathPrefix}${indexStr}.json`,
          type: 'application/json',
          title: granule.umm.GranuleUR,
        });
      }
    }
  }
}
