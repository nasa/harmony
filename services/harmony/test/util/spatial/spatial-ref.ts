import assert from 'assert';

import { fromUserInput } from '../../../app/util/spatial/spatial-ref';

describe('fromUserInput CRS parsing', () => {
  describe('EPSG codes', () => {
    describe('EPSG:4326', () => {
      const result = fromUserInput('EPSG : 4326');
      it('recognizes the EPSG code', () => {
        assert.strictEqual(result.epsg, 'EPSG:4326');
      });
      it('includes +proj=longlat in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=longlat'));
      });
      it('WKT contains WGS 84 datum and EPSG authority', () => {
        assert.ok(result.wkt.includes('WGS_1984'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","4326"]'));
      });
    });

    describe('EPSG:3857 (Web Mercator)', () => {
      const result = fromUserInput('EPSG:3857');
      it('recognizes the EPSG code', () => {
        assert.strictEqual(result.epsg, 'EPSG:3857');
      });
      it('includes +proj=merc in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=merc'));
      });
      it('WKT contains Pseudo-Mercator name and EPSG authority', () => {
        assert.ok(result.wkt.includes('Pseudo-Mercator') || result.wkt.includes('Popular Visualisation'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","3857"]'));
      });
    });

    describe('EPSG:32632 (UTM zone 32N)', () => {
      const result = fromUserInput('EPSG:32632');
      it('recognizes the EPSG code', () => {
        assert.strictEqual(result.epsg, 'EPSG:32632');
      });
      it('includes +proj=utm in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=utm'));
      });
      it('WKT contains UTM zone 32N name and EPSG authority', () => {
        assert.ok(result.wkt.includes('UTM zone 32N'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","32632"]'));
      });
    });

    describe('EPSG:27700 (British National Grid)', () => {
      const result = fromUserInput('EPSG:27700');
      it('recognizes the EPSG code', () => {
        assert.strictEqual(result.epsg, 'EPSG:27700');
      });
      it('WKT contains British National Grid name and EPSG authority', () => {
        assert.ok(result.wkt.includes('British_National_Grid') || result.wkt.includes('British National Grid'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","27700"]'));
      });
    });

    describe('EPSG:4269 (NAD83)', () => {
      const result = fromUserInput('EPSG:4269');
      it('recognizes the EPSG code', () => {
        assert.strictEqual(result.epsg, 'EPSG:4269');
      });
      it('includes +proj=longlat in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=longlat'));
      });
      it('WKT contains NAD83 datum and EPSG authority', () => {
        assert.ok(result.wkt.includes('NAD83') || result.wkt.includes('North_American_Datum_1983'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","4269"]'));
      });
    });

    it('accepts lowercase epsg: prefix', () => {
      assert.strictEqual(fromUserInput('epsg:4326').epsg, 'EPSG:4326');
    });

    it('accepts EPSGA: variant', () => {
      assert.strictEqual(fromUserInput('EPSGA:4326').epsg, 'EPSG:4326');
    });

    it('throws for an unknown EPSG code', () => {
      assert.throws(() => fromUserInput('EPSG:99999999'));
    });
  });

  describe('CRS:84', () => {
    const result = fromUserInput('CRS:84');
    it('resolves to EPSG:4326', () => {
      assert.strictEqual(result.epsg, 'EPSG:4326');
    });
    it('includes +proj=longlat in the proj4 string', () => {
      assert.ok(result.proj4String.includes('+proj=longlat'));
    });
    it('WKT contains WGS 84 datum and EPSG authority', () => {
      assert.ok(result.wkt.includes('WGS_1984'));
      assert.ok(result.wkt.includes('AUTHORITY["EPSG","4326"]'));
    });
    it('accepts lowercase crs:84', () => {
      assert.strictEqual(fromUserInput('crs:84').epsg, 'EPSG:4326');
    });
  });

  describe('OGC URNs', () => {
    it('resolves urn:ogc:def:crs:EPSG::4326 to EPSG:4326', () => {
      assert.strictEqual(fromUserInput('urn:ogc:def:crs:EPSG::4326').epsg, 'EPSG:4326');
    });
    it('WKT for urn:ogc:def:crs:EPSG::4326 contains WGS 84 datum', () => {
      assert.ok(fromUserInput('urn:ogc:def:crs:EPSG::4326').wkt.includes('WGS_1984'));
    });
    it('resolves URN:OGC:DEF:CRS:EPSG::3857 case-insensitively', () => {
      assert.strictEqual(fromUserInput('URN:OGC:DEF:CRS:EPSG::3857').epsg, 'EPSG:3857');
    });
  });

  describe('opengis.net PURLs', () => {
    it('resolves http PURL for EPSG:4326', () => {
      assert.strictEqual(fromUserInput('http://www.opengis.net/def/crs/EPSG/0/4326').epsg, 'EPSG:4326');
    });
    it('WKT for http PURL contains WGS 84 datum', () => {
      assert.ok(fromUserInput('http://www.opengis.net/def/crs/EPSG/0/4326').wkt.includes('WGS_1984'));
    });
    it('resolves https PURL for EPSG:32632', () => {
      assert.strictEqual(fromUserInput('https://www.opengis.net/def/crs/EPSG/0/32632').epsg, 'EPSG:32632');
    });
  });

  describe('well-known names', () => {
    it('resolves WGS84 to EPSG:4326', () => {
      assert.strictEqual(fromUserInput('WGS84').epsg, 'EPSG:4326');
    });
    it('resolves NAD83 to EPSG:4269', () => {
      assert.strictEqual(fromUserInput('NAD83').epsg, 'EPSG:4269');
    });
    it('resolves NAD27 to EPSG:4267', () => {
      assert.strictEqual(fromUserInput('NAD27').epsg, 'EPSG:4267');
    });
  });

  describe('proj4 strings', () => {
    describe('+proj=longlat +datum=WGS84 +no_defs', () => {
      const result = fromUserInput('+proj=longlat +datum=WGS84 +no_defs');
      it('reverse-looks up EPSG:4326', () => {
        assert.strictEqual(result.epsg, 'EPSG:4326');
      });
      it('WKT contains WGS 84 datum and EPSG authority', () => {
        assert.ok(result.wkt.includes('WGS_1984'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","4326"]'));
      });
    });

    describe('+proj=utm +zone=32 +datum=WGS84 +units=m', () => {
      const result = fromUserInput('+proj=utm +zone=32 +datum=WGS84 +units=m');
      it('reverse-looks up EPSG:32632', () => {
        assert.strictEqual(result.epsg, 'EPSG:32632');
      });
      it('WKT contains UTM zone 32N and EPSG authority', () => {
        assert.ok(result.wkt.includes('UTM zone 32N'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","32632"]'));
      });
    });

    describe('LCC string matching EPSG:102004', () => {
      const result = fromUserInput('+proj=lcc +lat_1=33 +lat_2=45 +lat_0=39 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs');
      it('reverse-looks up EPSG:102004', () => {
        assert.strictEqual(result.epsg, 'EPSG:102004');
      });
      it('includes +proj=lcc in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=lcc'));
      });
      it('WKT contains Lambert and NAD83', () => {
        assert.ok(result.wkt.includes('Lambert'));
        assert.ok(result.wkt.includes('NAD83') || result.wkt.includes('North_American_Datum_1983'));
      });
    });

    describe('custom LCC with no matching EPSG code', () => {
      const result = fromUserInput('+proj=lcc +lat_1=37.5 +lat_2=47.5 +lat_0=42 +lon_0=-100 +x_0=1234567 +y_0=9876543 +datum=NAD83 +units=m +no_defs');
      it('returns an empty epsg string', () => {
        assert.strictEqual(result.epsg, '');
      });
      it('includes +proj=lcc in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=lcc'));
      });
      it('returns null for WKT', () => {
        assert.strictEqual(result.wkt, null);
      });
    });
  });

  describe('WKT input', () => {
    describe('WKT1 GEOGCS with AUTHORITY', () => {
      const wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
      const result = fromUserInput(wkt);
      it('extracts EPSG:4326 from the AUTHORITY tag', () => {
        assert.strictEqual(result.epsg, 'EPSG:4326');
      });
      it('includes +proj=longlat in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=longlat'));
      });
      it('WKT contains WGS 84 datum and EPSG authority', () => {
        assert.ok(result.wkt.includes('WGS_1984'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","4326"]'));
      });
    });

    describe('WKT1 PROJCS with AUTHORITY', () => {
      const wkt = 'PROJCS["WGS 84 / UTM zone 32N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","32632"]]';
      const result = fromUserInput(wkt);
      it('extracts EPSG:32632 from the AUTHORITY tag', () => {
        assert.strictEqual(result.epsg, 'EPSG:32632');
      });
      it('includes +proj=utm in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=utm'));
      });
      it('WKT contains UTM zone 32N and EPSG authority', () => {
        assert.ok(result.wkt.includes('UTM zone 32N'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","32632"]'));
      });
    });

    describe('WKT2 BASEGEOGCRS with ID', () => {
      const wkt = 'PROJCRS["NAD83(NSRS2007) / Idaho Central",BASEGEOGCRS["NAD83(NSRS2007)",DATUM["NAD83 (National Spatial Reference System 2007)",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4759]],CONVERSION["SPCS83 Idaho Central zone (meter)",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",41.6666666666667,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",-114,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["Scale factor at natural origin",0.999947368,SCALEUNIT["unity",1],ID["EPSG",8805]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[BBOX[41.99,-115.3,45.7,-112.67]],ID["EPSG",3522]]';
      const result = fromUserInput(wkt);
      it('extracts EPSG:3522 from the ID tag', () => {
        assert.strictEqual(result.epsg, 'EPSG:3522');
      });
      it('includes +proj=tmerc and +ellps=GRS80 in the proj4 string', () => {
        assert.ok(result.proj4String.includes('+proj=tmerc'));
        assert.ok(result.proj4String.includes('+ellps=GRS80'));
      });
      it('WKT contains projection transverse mercator and EPSG authority', () => {
        assert.ok(result.wkt.includes('PROJECTION["Transverse_Mercator"]'));
        assert.ok(result.wkt.includes('AUTHORITY["EPSG","3522"]'));
      });
    });

  });

  describe('invalid input', () => {
    it('throws for an unknown EPSG code', () => {
      assert.throws(() => fromUserInput('EPSG:99999999'));
    });
    it('throws for completely unrecognised input', () => {
      assert.throws(() => fromUserInput('complete nonsense'));
    });
  });
});
