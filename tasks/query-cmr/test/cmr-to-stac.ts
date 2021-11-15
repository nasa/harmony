import { StacAsset, StacItem } from '../app/stac/types';
import { expect } from 'chai';
import _ from 'lodash';
import CmrCatalog, { bboxToGeometry } from '../app/stac/cmr-catalog';

describe('bboxToGeometry conversion', function () {
  it('provides a single polygon for bboxes that do not cross the antimeridian', function () {
    expect(bboxToGeometry([100, 0, -100, 50])).to.eql({
      type: 'MultiPolygon',
      coordinates: [
        [[[-180, 0], [-180, 50], [-100, 50], [-100, 0], [-180, 0]]],
        [[[100, 0], [100, 50], [180, 50], [180, 0], [100, 0]]],
      ],
    });
  });

  it('splits bboxes that cross the antimeridian into two polygons, one for each side', function () {
    expect(bboxToGeometry([-100, 0, 100, 50])).to.eql({
      type: 'Polygon',
      coordinates: [
        [[-100, 0], [-100, 50], [100, 50], [100, 0], [-100, 0]],
      ],
    });
  });
});

describe('addCmrGranules to catalog', function () {
  describe('asset extraction', function () {
    let catalog: CmrCatalog;
    let assets: { [name: string]: StacAsset };
    before(function () {
      catalog = new CmrCatalog({ description: 'test' });
      catalog.addCmrGranules([{
        id: 'G0_TEST',
        title: 'g0',
        time_start: '2019-01-01T00:00:00Z',
        time_end: '2019-01-02T00:00:00Z',
        links: [
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            type: 'application/x-netcdf4',
            href: './g0_0.nc4',
            title: 'Data 0',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            type: 'application/x-netcdf4',
            href: './g0_1.nc4',
            title: 'Data 1',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            type: 'application/x-netcdf4',
            href: './g0_2.nc4',
            title: 'Inherited Data 2',
            inherited: true,
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/metadata#',
            type: 'application/json',
            href: './g0_3.json',
            title: 'Metadata 3',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            type: 'application/x-netcdf4',
            href: './g0_4.nc4',
            title: 'OPeNDAP Data 4',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            type: 'application/x-netcdf4',
            href: './g0_5.nc4',
            title: 'OPeNDAP Data 5',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/service#',
            title: 'OPeNDAP request URL (GET DATA : OPENDAP DATA)',
            href: 'https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/AIRS.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
            type: 'application/x-hdf',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/service#',
            title: 'OPeNTRAP request URL',
            href: 'https://gesdisc.nasa.gov/opentrap/Aqua_AIRS_Level3/AIR222P5.006/2002/abcd.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
            type: 'application/x-hdf',
          },
          {
            rel: 'http://esipfed.org/ns/fedsearch/1.1/data#',
            title: 'OPeNDAP request URL (GET DATA : OPENDAP DATA)',
            href: 'https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/123.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
            type: 'application/x-hdf',
          },
        ],
      }, {
        id: 'G1_TEST',
        title: 'g1',
        time_start: '2019-01-01T00:00:00Z',
        time_end: '2019-01-02T00:00:00Z',
      }], './test/granule_');
      // eslint-disable-next-line prefer-destructuring
      assets = (catalog.children[0] as StacItem).assets;
    });

    it('ignores inherited links', function () {
      expect(_.map(_.values(assets), 'href')).to.not.include('./g0_2.nc4');
    });

    it('extracts non-inherited data links', function () {
      expect(_.map(_.values(assets), 'href')).to.include('./g0_0.nc4');
      expect(_.map(_.values(assets), 'href')).to.include('./g0_1.nc4');
    });

    it('names the first data link "data"', function () {
      expect(assets.data).to.eql({
        href: './g0_0.nc4',
        title: 'g0_0.nc4',
        description: 'Data 0',
        type: 'application/x-netcdf4',
        roles: ['data'],
      });
    });

    it('numbers subsequent data links', function () {
      expect(assets.data1).to.eql({
        href: './g0_1.nc4',
        title: 'g0_1.nc4',
        description: 'Data 1',
        type: 'application/x-netcdf4',
        roles: ['data'],
      });
    });

    it('names OPeNDAP links "opendap" and gives them an "opendap" role', function () {
      expect(assets.opendap).to.eql({
        href: './g0_4.nc4',
        title: 'g0_4.nc4',
        description: 'OPeNDAP Data 4',
        type: 'application/x-netcdf4',
        roles: ['data', 'opendap'],
      });
      expect(assets.opendap1).to.eql({
        href: './g0_5.nc4',
        title: 'g0_5.nc4',
        description: 'OPeNDAP Data 5',
        type: 'application/x-netcdf4',
        roles: ['data', 'opendap'],
      });
      expect(assets.opendap2).to.eql({
        href: 'https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/AIRS.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
        title: 'AIRS.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
        description: 'OPeNDAP request URL (GET DATA : OPENDAP DATA)',
        type: 'application/x-hdf',
        roles: ['data', 'opendap'],
      });
      expect(assets.opendap3).to.eql({
        href: 'https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/123.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
        title: '123.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf',
        description: 'OPeNDAP request URL (GET DATA : OPENDAP DATA)',
        type: 'application/x-hdf',
        roles: ['data', 'opendap'],
      });
      expect(assets.data2).to.be.undefined;
    });

    it('includes OPeNDAP links with rel ending in both service# and data#', function () {
      expect(_.map(_.values(assets), 'href'))
        .to.include('https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/123.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf');
      expect(_.map(_.values(assets), 'href'))
        .to.include('https://gesdisc.nasa.gov/opendap/Aqua_AIRS_Level3/AIR222P5.006/2002/AIRS.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf');
    });

    it('ignores non-OPeNDAP non-data links', function () {
      expect(_.map(_.values(assets), 'href')).to.not.include('./g0_3.json');
      expect(_.map(_.values(assets), 'href')).to.not.include('./abcd.2222.09.01.L3.RetQuant_IR005.v6.0.9.0.G111160515.hdf');
    });

    it('does not catalog granules with no valid data links', function () {
      expect(catalog.children.length).to.equal(1);
      expect(catalog.links.length).to.equal(1);
    });
  });
});
