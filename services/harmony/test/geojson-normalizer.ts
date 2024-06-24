import { expect } from 'chai';
import { normalizeGeoJsonCoords, normalizeGeoJson } from '../app/middleware/shapefile-converter';

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
              137.0443248426335,
              -23.187360507938507,
            ],
            [
              142.60865606481002,
              -30.037061045258376,
            ],
            [
              147.98806952083328,
              -23.833953853558924,
            ],
            [
              137.0443248426335,
              -23.187360507938507,
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
              195.41830544133046,
              -17.162025743177352,
            ],
            [
              210.29952727018542,
              -25.268090986321695,
            ],
            [
              211.48923396024566,
              -13.895953534230472,
            ],
            [
              195.41830544133046,
              -17.162025743177352,
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

describe('normalizeGeoJsonCoords', () => {
  it('should normalize longitudes to the range [-180, 180]', function () {
    const normalizedGeoJson = normalizeGeoJsonCoords(outsideLongitudeRangeSampleGeoJson);

    expect(normalizedGeoJson.features[0].geometry.coordinates[0]).to.equal(200 - 360); // -160
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

  it('does not change the result when called more than once', function () {
    let normalizedGeoJson = normalizeGeoJson(crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson);
    normalizedGeoJson = normalizeGeoJson(normalizedGeoJson);
    expect(normalizedGeoJson).to.eql(expectedNormalization);
  });
});