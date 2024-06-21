import { expect } from 'chai';
import { normalizeGeoJsonCoords, normalizeGeoJson } from '../app/middleware/shapefile-converter';

// Sample GeoJSON data for testing
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

describe('normalizeGeoJSON', () => {
  it('should normalize longitudes to the range [-180, 180]', () => {
    const normalizedGeoJSON = normalizeGeoJsonCoords(outsideLongitudeRangeSampleGeoJson);

    expect(normalizedGeoJSON.features[0].geometry.coordinates[0]).to.equal(200 - 360); // -160
    expect(normalizedGeoJSON.features[1].geometry.coordinates[0][0]).to.equal(-190 + 360); // 170
    expect(normalizedGeoJSON.features[1].geometry.coordinates[1][0]).to.equal(190 - 360); // -170
  });
});

describe('normalizeGeoJson', function () {
  it('splits polygons at the antimeridian', function () {
    const normalizedGeoJson = normalizeGeoJson(crossingAntimeridianWithLongitudesOutsideRangeSampleGeoJson);
    expect(normalizedGeoJson).to.eql(
      {
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
      },
    );
  });
});