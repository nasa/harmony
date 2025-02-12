import { expect } from 'chai';
import * as fs from 'fs';
import path from 'path';

import {
  convertPointsToPolygons, normalizeGeoJson, normalizeGeoJsonCoords, numberOfSidesForPointCircle,
} from '../app/middleware/shapefile-converter';

// Simple geojson that should not change when normalized
const simpleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -82.9060361200349,
              38.00126623623561,
            ],
            [
              -75.38499926660272,
              32.861695354064466,
            ],
            [
              -68.87841600268153,
              38.08582977237779,
            ],
            [
              -76.49247626991905,
              40.05822321215504,
            ],
            [
              -82.9060361200349,
              38.00126623623561,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

const acrossThePrimeMeridianGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -27.762963687656622,
              53.53504835094779,
            ],
            [
              -2.572594944586797,
              43.36615583927019,
            ],
            [
              27.826200868334553,
              52.35925317733364,
            ],
            [
              -27.762963687656622,
              53.53504835094779,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

const twoTrianglesOnEitherSideOfAntimeridian = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -151.34381596015533,
              4.994679551918452,
            ],
            [
              -145.9836860515562,
              -3.1183737385664188,
            ],
            [
              -139.34984479441488,
              5.680029195822215,
            ],
            [
              -151.34381596015533,
              4.994679551918452,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              147.2919221979366,
              6.698088472127779,
            ],
            [
              152.58879278200553,
              -3.1660630298596857,
            ],
            [
              163.56990277600974,
              7.576864398832285,
            ],
            [
              147.2919221979366,
              6.698088472127779,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

const acrossTheEquatorGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -35.272765984652466,
              2.203467669034154,
            ],
            [
              -20.609947107159712,
              -19.022693890415283,
            ],
            [
              -19.098948215635716,
              10.7567274283346,
            ],
            [
              -35.272765984652466,
              2.203467669034154,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

const twoTrianglesAboveAndBelowEquatorGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -45.50020023177265,
              28.211401906489115,
            ],
            [
              -35.60798563975604,
              18.52021996710917,
            ],
            [
              -26.94301338420678,
              26.264323354545937,
            ],
            [
              -45.50020023177265,
              28.211401906489115,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -22.480605886727545,
              -16.237132962151293,
            ],
            [
              -18.51090445734397,
              -23.549769469071293,
            ],
            [
              -10.330945128376158,
              -17.20479596029881,
            ],
            [
              -22.480605886727545,
              -16.237132962151293,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

// Sample GeoJson data for testing longitudes outside [-180,180]
const outsideLongitudeRangeSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [200, 40],
      },
      properties: {},
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[-190, 10], [190, 20]],
      },
      properties: {},
    },
  ],
};

const pointNoRadiusSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [100, 40],
      },
      properties: {},
    },
  ],
};

// the failing example from HARMONY-2001
const pointRadiusSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          -118.2832,
          34.03321,
        ],
      },
      properties: {
        radius: 136593,
      },
    },
  ],
  properties: {
    summary: 'Shapefile created by Earthdata Search to support spatial subsetting when requesting data from Harmony.',
  },
};

const multiPointNoRadiusSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [100, 40],
          [150, 40],
        ],
      },
      properties: {},
    },
  ],
};

const multiPointRadiusSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [100, 40],
          [150, 40],
        ],
      },
      properties: {
        radius: 136593,
      },
    },
  ],
};

const clockwiseWindingGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -79.93769413144278,
              37.88089617938101,
            ],
            [
              -74.4094454860988,
              41.45283160828291,
            ],
            [
              -69.48801019683185,
              34.167397708133024,
            ],
            [
              -79.93769413144278,
              37.88089617938101,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

const correctedWindingGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          [
            [
              -79.93769413144278,
              37.88089617938101,
            ],
            [
              -69.48801019683185,
              34.167397708133024,
            ],
            [
              -74.4094454860988,
              41.45283160828291,
            ],
            [
              -79.93769413144278,
              37.88089617938101,
            ],
          ],
        ],
        type: 'Polygon',
      },
    },
  ],
};

// This geojson is from the HARMONY-1784 Jira ticket
const crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [[[-189.39835546840183, -71.30184718454765], [-196.93423129853957, -74.24875148066187], [-199.01126455296102, -76.99500221847319], [-196.01615081260698, -78.29244034236493], [-162.51718990801453, -79.03063047059774], [-148.37161275139798, -76.90896062169273], [-142.83828400653184, -75.05376361670923], [-189.39835546840183, -71.30184718454765]]],
        type: 'Polygon',
      },
    }],
};

const expectedNormalization = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [
                180,
                -72.059188039277,
              ],
              [
                170.60164453159817,
                -71.30184718454765,
              ],
              [
                163.06576870146043,
                -74.24875148066187,
              ],
              [
                160.98873544703898,
                -76.99500221847319,
              ],
              [
                163.98384918739302,
                -78.29244034236493,
              ],
              [
                180,
                -78.64537560073987,
              ],
              [
                180,
                -72.059188039277,
              ],
            ],
          ],
          [
            [
              [
                -180,
                -78.64537560073987,
              ],
              [
                -162.51718990801453,
                -79.03063047059774,
              ],
              [
                -148.37161275139798,
                -76.90896062169273,
              ],
              [
                -142.83828400653184,
                -75.05376361670923,
              ],
              [
                -180,
                -72.059188039277,
              ],
              [
                -180,
                -78.64537560073987,
              ],
            ],
          ],
        ],
      },
      properties: {},
    },
  ],
};

const geoJsonFilesThatShouldNotChange = [
  simpleGeoJson,
  acrossThePrimeMeridianGeoJson,
  acrossTheEquatorGeoJson,
  twoTrianglesOnEitherSideOfAntimeridian,
  twoTrianglesAboveAndBelowEquatorGeoJson,
];

describe('numberOfSidesForPointCircle', function () {
  describe('when the radius is small', function () {
    it('has four sides', function () {
      const sides = numberOfSidesForPointCircle(0.1);
      expect(sides).to.equal(4);
    });
  });
  describe('when the radius is large', function () {
    it('limits the number of sides', function () {
      const sides = numberOfSidesForPointCircle(1000000);
      expect(sides).to.equal(100);
    });
  });
});

describe('convertPointsToPolygons', () => {
  const pointTestCases = [
    [pointNoRadiusSampleGeoJson, 'pointNoRadiusCircleExpected'],
    [pointRadiusSampleGeoJson, 'pointRadiusCircleExpected'],
  ];

  for (const [testGeoJson, expectedOutputFile] of pointTestCases) {
    const expectedOutputJson = fs.readFileSync(path.resolve(__dirname, `resources/${expectedOutputFile}.geojson`), 'utf8');

    const normalizedGeoJson = convertPointsToPolygons(testGeoJson);
    it('should convert Points to Polygons', function () {
      expect(normalizedGeoJson.features[0].geometry.type).to.equal('Polygon');
      expect(JSON.stringify(normalizedGeoJson, null, 2)).to.eql(expectedOutputJson);
    });
  }

  const multiPointTestCases = [
    [multiPointNoRadiusSampleGeoJson, 'multiPointNoRadiusCircleExpected'],
    [multiPointRadiusSampleGeoJson, 'multiPointRadiusCircleExpected'],
  ];

  for (const [testGeoJson, expectedOutputFile] of multiPointTestCases) {
    const expectedOutputJson = fs.readFileSync(path.resolve(__dirname, `resources/${expectedOutputFile}.geojson`), 'utf8');

    const normalizedGeoJson = convertPointsToPolygons(testGeoJson);
    it('should convert MultiPoints to MultiPolygons', function () {
      expect(normalizedGeoJson.features[0].geometry.type).to.equal('MultiPolygon');
      expect(JSON.stringify(normalizedGeoJson, null, 2)).to.eql(expectedOutputJson);
    });
  }

  describe('when a geojson file contains points as well as other features', function () {
    const normalizedGeoJson = convertPointsToPolygons(outsideLongitudeRangeSampleGeoJson);
    it('does not change the other features', function () {
      expect(normalizedGeoJson.features[1].geometry.type).to.equal('LineString');
    });
  });
});

describe('normalizeGeoJsonCoords', () => {
  it('should normalize longitudes to the range [-180, 180]', function () {
    const normalizedGeoJson = normalizeGeoJsonCoords(outsideLongitudeRangeSampleGeoJson);

    expect(normalizedGeoJson.features[0].geometry.coordinates[0][0][0]).to.equal(200 - 360); // -160
    expect(normalizedGeoJson.features[1].geometry.coordinates[0][0]).to.equal(-190 + 360); // 170
    expect(normalizedGeoJson.features[1].geometry.coordinates[1][0]).to.equal(190 - 360); // -170
  });
});

describe('normalizeGeoJson', function () {
  for (const geoJson of geoJsonFilesThatShouldNotChange) {
    it('should not change already normalized polygons', () => {
      const normalizedGeoJson = normalizeGeoJson(geoJson);
      expect(normalizedGeoJson).to.eql(geoJson);
    });
  }

  it('should not change polygons that cross the equator, but not the antimeridian', function () {
    const normalizedGeoJson = normalizeGeoJson(acrossTheEquatorGeoJson);
    expect(normalizedGeoJson).to.eql(acrossTheEquatorGeoJson);
  });

  it('splits polygons at the antimeridian', function () {
    const normalizedGeoJson = normalizeGeoJson(crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson);
    expect(normalizedGeoJson).to.eql(expectedNormalization);
  });

  it('correct clockwise polygon winding to counter-clockwise', function () {
    const normalizedGeoJson = normalizeGeoJson(clockwiseWindingGeoJson);
    expect(normalizedGeoJson).to.eql(correctedWindingGeoJson);
  });

  it('does not change the result when called more than once', function () {
    let normalizedGeoJson = normalizeGeoJson(crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson);
    normalizedGeoJson = normalizeGeoJson(normalizedGeoJson);
    expect(normalizedGeoJson).to.eql(expectedNormalization);
  });
});