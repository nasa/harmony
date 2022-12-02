import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import apply from 'ajv-formats-draft2019';
import axios from 'axios';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import create, { HarmonyItem } from '../../app/frontends/stac-item';
import { buildJob } from '../helpers/jobs';

// Prop for testing
const jobProps = {
  requestId: '1234',
  request: 'example.com',
  username: 'jdoe',
  createdAt: new Date('2020-02-02T00:00:00Z'),
  numInputGranules: 5,
  links: [
    {
      href: 'file_1.nc',
      title: 'Item #1',
      type: 'application/nc',
      rel: 'data',
      bbox: [-80, -30, -100, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_2.png',
      title: 'Item #2',
      type: 'image/png',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_3.json',
      title: 'Item #3',
      type: 'application/json',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      href: 'file_4.csv',
      title: 'Item #4',
      type: 'text/csv',
      rel: 'data',
      bbox: [-100, -30, -80, 20],
      temporal: {
        start: '1996-10-15T00:05:32.000Z',
        end: '1996-11-15T00:05:32.000Z',
      },
    },
    {
      // no STAC metadata
      href: 'file_5.nc',
      title: 'Item #1',
      type: 'application/nc',
      rel: 'data',
    },
  ],
};

const job = buildJob(jobProps as unknown);

/**
 * Load a JSON schema file from a url
 *
 * @param url - The location of the schema file
 * @returns a promise containing an object for the JSON schema
 */
async function loadSchema(url: string): Promise<Object>  {
  const res = await axios.get(url);
  if (res.status >= 400) throw new Error('Error loading JSON schema: ' + res.status);
  return res.data;
}

import * as schema from '../resources/stac-schema/1.0.0/item.json';

/**
 *  Create a validator for STAC schema files
 * @returns A STAC item schema validation function
 */
async function getValidator(): Promise<ValidateFunction<unknown>> {
  const ajv = new Ajv({ loadSchema: loadSchema, strictTypes: false });
  addFormats(ajv);
  apply(ajv);
  await ajv.compileAsync(schema);

  return ajv.getSchema('https://schemas.stacspec.org/v1.0.0/item-spec/json-schema/item.json#');
}

describe('stac-item', async function () {
  let validate;
  before(async function () {
    validate = await getValidator();
  });
  describe('STAC Item creation with a Harmony Job object: case of anti-meridian crossing', function () {
    const jsonObj = create(job.jobID, job.request, job.links[0], 0, null, job.createdAt);
    it('Item has correct ID', function () {
      expect(jsonObj.id).to.equal(`${jobProps.requestId}_0`);
    });
    it('has a bounding box that crosses anti-meridian', function () {
      expect(jsonObj.geometry.type).to.equal('MultiPolygon');
    });
    it('has the creation time', function () {
      expect(jsonObj.properties.created).to.equal('2020-02-02T00:00:00.000Z');
    });
    it('has the representative date time', function () {
      expect(jsonObj.properties.datetime).to.equal('1996-10-15T00:05:32.000Z');
    });
    it('has self-referencing links', function () {
      expect(jsonObj.links.length).to.equal(2);
    });
    it('has roles for the asset', function () {
      expect(jsonObj.assets['file_1.nc'].roles[0]).to.equal('data');
    });
    it('validates against the STAC schema', function () {
      const res = validate(jsonObj);
      expect(res).to.be.true;
    });
  });

  describe('STAC Item creation with a Harmony Job object: case without anti-meridian crossing', function () {
    const jsonObj: HarmonyItem = create(
      job.jobID, job.request, job.links[1], 1, null, job.createdAt,
    );
    it('has a bounding box that doesn\'t anti-meridian', function () {
      expect(jsonObj.geometry.type).to.equal('Polygon');
    });
    it('has roles for the asset', function () {
      expect(jsonObj.assets['file_2.png'].roles[0]).to.equal('overview');
    });
    it('validates against the STAC schema', function () {
      const res = validate(jsonObj);
      expect(res).to.be.true;
    });
  });

  describe('STAC Item creation with a Harmony Job object: case of metadata assets', function () {
    const jsonObj = create(job.jobID, job.request, job.links[2], 2, null, job.createdAt);
    it('has an asset with metadata role', function () {
      expect(jsonObj.assets['file_3.json'].roles[0]).to.equal('metadata');
    });
    it('validates against the STAC schema', function () {
      const res = validate(jsonObj);
      expect(res).to.be.true;
    });
  });

  describe('STAC Item creation with a Harmony Job object: case of textual data', function () {
    const jsonObj = create(job.jobID, job.request, job.links[3], 3, null, job.createdAt);
    it('has an text asset with data role', function () {
      expect(jsonObj.assets['file_4.csv'].roles[0]).to.equal('data');
    });
    it('validates against the STAC schema', function () {
      const res = validate(jsonObj);
      expect(res).to.be.true;
    });
  });
});
