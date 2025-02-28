import { expect } from 'chai';
import * as fs from 'fs';
import path from 'path';

import {
  convertPointsToPolygons, normalizeGeoJson, normalizeGeoJsonCoords, numberOfSidesForPointCircle,
} from '../app/middleware/shapefile-converter';

// Simple geojson that should not change when normalized
const simpleGeoJson = {
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -82.906036,
              38.001266,
            ],
            [
              -75.384999,
              32.861695,
            ],
            [
              -68.878416,
              38.08583,
            ],
            [
              -76.492476,
              40.058223,
            ],
            [
              -82.906036,
              38.001266,
            ],
          ],
        ],
      },
      'properties': {},
    },
  ],
};

const acrossThePrimeMeridianGeoJson = {
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -27.762964,
              53.535048,
            ],
            [
              -2.572595,
              43.366156,
            ],
            [
              27.826201,
              52.359253,
            ],
            [
              -27.762964,
              53.535048,
            ],
          ],
        ],
      },
      'properties': {},
    },
  ],
};

const twoTrianglesOnEitherSideOfAntimeridian = {
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -151.343816,
              4.99468,
            ],
            [
              -145.983686,
              -3.118374,
            ],
            [
              -139.349845,
              5.680029,
            ],
            [
              -151.343816,
              4.99468,
            ],
          ],
        ],
      },
      'properties': {},
    },
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              147.291922,
              6.698088,
            ],
            [
              152.588793,
              -3.166063,
            ],
            [
              163.569903,
              7.576864,
            ],
            [
              147.291922,
              6.698088,
            ],
          ],
        ],
      },
      'properties': {},
    },
  ],
};

const acrossTheEquatorGeoJson = {
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -35.272766,
              2.203468,
            ],
            [
              -20.609947,
              -19.022694,
            ],
            [
              -19.098948,
              10.756727,
            ],
            [
              -35.272766,
              2.203468,
            ],
          ],
        ],
      },
      'properties': {},
    },
  ],
};

const twoTrianglesAboveAndBelowEquatorGeoJson = {
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -45.5002,
              28.211402,
            ],
            [
              -35.607986,
              18.52022,
            ],
            [
              -26.943013,
              26.264323,
            ],
            [
              -45.5002,
              28.211402,
            ],
          ],
        ],
      },
      'properties': {},
    },
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [
              -22.480606,
              -16.237133,
            ],
            [
              -18.510904,
              -23.549769,
            ],
            [
              -10.330945,
              -17.204796,
            ],
            [
              -22.480606,
              -16.237133,
            ],
          ],
        ],
      },
      'properties': {},
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
              -79.937694,
              37.880896,
            ],
            [
              -69.48801,
              34.167398,
            ],
            [
              -74.409445,
              41.452832,
            ],
            [
              -79.937694,
              37.880896,
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
  'type': 'FeatureCollection',
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'MultiPolygon',
        'coordinates': [
          [
            [
              [
                180,
                -72.059188,
              ],
              [
                170.601645,
                -71.301847,
              ],
              [
                163.065769,
                -74.248751,
              ],
              [
                160.988735,
                -76.995002,
              ],
              [
                163.983849,
                -78.29244,
              ],
              [
                180,
                -78.645375,
              ],
              [
                180,
                -72.059188,
              ],
            ],
          ],
          [
            [
              [
                -180,
                -78.645375,
              ],
              [
                -162.51719,
                -79.03063,
              ],
              [
                -148.371613,
                -76.908961,
              ],
              [
                -142.838284,
                -75.053764,
              ],
              [
                -180,
                -72.059188,
              ],
              [
                -180,
                -78.645375,
              ],
            ],
          ],
        ],
      },
      'properties': {},
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
    const expectedOutputJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, `resources/${expectedOutputFile}.geojson`), 'utf8'));

    let normalizedGeoJson = convertPointsToPolygons(testGeoJson);
    normalizedGeoJson = normalizeGeoJsonCoords(normalizedGeoJson);
    it('should convert Points to Polygons', function () {
      expect(normalizedGeoJson.features[0].geometry.type).to.equal('Polygon');
      expect(normalizedGeoJson).to.eql(expectedOutputJson);
    });
  }

  const multiPointTestCases = [
    [multiPointNoRadiusSampleGeoJson, 'multiPointNoRadiusCircleExpected'],
    [multiPointRadiusSampleGeoJson, 'multiPointRadiusCircleExpected'],
  ];

  for (const [testGeoJson, expectedOutputFile] of multiPointTestCases) {
    const expectedOutputJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, `resources/${expectedOutputFile}.geojson`), 'utf8'));

    let normalizedGeoJson = convertPointsToPolygons(testGeoJson);
    normalizedGeoJson = normalizeGeoJsonCoords(normalizedGeoJson);
    it('should convert MultiPoints to MultiPolygons', function () {
      expect(normalizedGeoJson.features[0].geometry.type).to.equal('MultiPolygon');
      expect(normalizedGeoJson).to.eql(expectedOutputJson);
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

  it('corrects clockwise polygon winding to counter-clockwise', function () {
    const normalizedGeoJson = normalizeGeoJson(clockwiseWindingGeoJson);
    expect(normalizedGeoJson).to.eql(correctedWindingGeoJson);
  });

  it('does not change the result when called more than once', function () {
    let normalizedGeoJson = normalizeGeoJson(crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson);
    normalizedGeoJson = normalizeGeoJson(normalizedGeoJson);
    expect(normalizedGeoJson).to.eql(expectedNormalization);
  });
});