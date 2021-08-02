import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import _ from 'lodash';
import logger from '../util/log';
import { CmrUmmVariable } from '../util/cmr';
import { Encrypter, Decrypter } from '../util/crypto';

/**
 * Synchronously reads and parses the JSON Schema at the given path
 *
 * @param version - The version number of the schema to read
 * @returns The parsed JSON Schema object
 */
function readSchema(version: string): object {
  const schemaPath = path.join(__dirname, '..', 'schemas', 'data-operation', version, `data-operation-v${version}.json`);
  return JSON.parse(fs.readFileSync(schemaPath).toString());
}

interface SchemaVersion {
  // The version number of the given schema
  version: string;
  // The JSON schema for the version, parsed into an object
  schema: object;
  // A function that takes a model in the schema's version and returns a
  // model for the schema one version lower.  If this is not provided, schema translations will
  // be unable to downgrade from the version
  down?: (unknown) => unknown;
}

let _schemaVersions: SchemaVersion[];
/**
 * Memoized list of schema objects in order of descending version number.
 * @returns a memoized list of schema objects in order of descending version number.
 */
function schemaVersions(): SchemaVersion[] {
  if (_schemaVersions) return _schemaVersions;
  _schemaVersions = [
    {
      version: '0.11.0',
      schema: readSchema('0.11.0'),
      down: (model): unknown => model,
    },
    {
      version: '0.10.0',
      schema: readSchema('0.10.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        if (_.has(revertedModel, 'format.srs')) {
          delete revertedModel.format.srs; // eslint-disable-line no-param-reassign
        }

        return revertedModel;
      },
    },
    {
      version: '0.9.0',
      schema: readSchema('0.9.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        if ('accessToken' in revertedModel) {
          delete revertedModel.accessToken; // eslint-disable-line no-param-reassign
        }

        return revertedModel;
      },
    },
    {
      version: '0.8.0',
      schema: readSchema('0.8.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        revertedModel.sources.forEach((s) => {
          if (s.variables) {
            s.variables.forEach((v) => {
              delete v.fullPath; // eslint-disable-line no-param-reassign
            });
          }
        });

        return revertedModel;
      },
    },
    {
      version: '0.7.0',
      schema: readSchema('0.7.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        // remove the `bbox` and `temporal` fields from all the granules in all the sources
        revertedModel.sources.forEach((s) => {
          s.granules.forEach((g) => {
            // eslint-disable-next-line no-param-reassign
            delete g.bbox;
            // eslint-disable-next-line no-param-reassign
            delete g.temporal;
          });
        });

        return revertedModel;
      },
    },
    {
      version: '0.6.0',
      schema: readSchema('0.6.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        delete revertedModel.subset.shape;
        delete revertedModel.stagingLocation;
        return revertedModel;
      },
    },
    {
      version: '0.5.0',
      schema: readSchema('0.5.0'),
      down: (model): unknown => {
        const revertedModel = _.cloneDeep(model);
        delete revertedModel.format.interpolation;
        delete revertedModel.format.scaleExtent;
        delete revertedModel.format.scaleSize;
        return revertedModel;
      },
    },
    {
      version: '0.4.0',
      schema: readSchema('0.4.0'),
    },
  ];
  return _schemaVersions;
}

let _validator: Ajv.Ajv;
/**
 * @returns a memoized validator for the data operations schema
 */
function validator(): Ajv.Ajv {
  if (_validator) return _validator;
  _validator = new Ajv({ schemaId: 'auto' });
  for (const { schema, version } of schemaVersions()) {
    _validator.addSchema(schema, version);
  }
  return _validator;
}

export interface HarmonyVariable {
  id: string;
  name: string;
}

export interface TemporalRange {
  start?: Date;
  end?: Date;
}

export interface TemporalStringRange {
  start?: string | Date;
  end?: string | Date;
}
export interface HarmonyGranule {
  id: string;
  name: string;
  url: string;
  temporal: TemporalStringRange;
  bbox?: number[];
}

interface DataSource {
  collection: string;
  granules: HarmonyGranule[];
  variables: HarmonyVariable[];
}

export interface SRS {
  proj4: string;
  wkt: string;
  epsg?: string;
}

/**
 * Encapsulates an operation to be performed against a backend.  Currently the
 * class is largely getters and setters.  The eventual intent is to allow us
 * to maintain multiple versions of the operation JSON schema, which this class
 * or its children would know how to serialize
 *
 */
export default class DataOperation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any; // Type checking is redundant with JSON schema checks

  granuleIds: string[];

  requireSynchronous: boolean;

  maxResults?: number;

  cmrHits?: number;

  scrollIDs?: string[] = [];

  cmrQueryLocations: string[] = [];

  encrypter?: Encrypter;

  decrypter?: Decrypter;

  message: string;

  requestStartTime: Date; // The time that the initial request to harmony was received

  /**
   * Creates an instance of DataOperation.
   *
   * @param model - The initial model, useful when receiving serialized operations
   * @param encrypter - A function used to encrypt the accessToken
   * @param decrypter - A function used to decrypt the accessToken
   *
   * Note that `decrypter(encrypter(message))` should equal `message`.
   *
   */
  constructor(
    model: object = null,
    encrypter: Encrypter = _.identity,
    decrypter: Decrypter = _.identity,
  ) {
    this.model = model || {
      sources: [],
      format: {},
      subset: {},
    };

    this.encrypter = encrypter;
    this.decrypter = decrypter;
  }

  /**
   * Returns the service data sources, a list of objects containing a collection ID with the
   * variables and granules to operate on.
   *
   * @returns The service data sources
   */
  get sources(): DataSource[] {
    return this.model.sources;
  }

  /**
   * Sets the service data sources, a list of objects containing a collection ID with the variables
   * and granules to operate on
   *
   * @param sources - The service data sources
   */
  set sources(sources: DataSource[]) {
    this.model.sources = sources;
  }

  /**
   * Returns the collections used in the data operation as
   * a list of strings
   *
   * @returns string[] of collections
   */
  get collectionIds(): string[] {
    return this.model.sources.map((s: DataSource) => s.collection);
  }

  /**
   * Adds a new service data source to the list of those to operate on
   *
   * @param collection - The CMR ID of the collection being operated on
   * @param vars - An array of objects containing variable id and name
   * @param granules - An array of objects containing granule id, name, and url
   */
  addSource(
    collection: string,
    vars?: CmrUmmVariable[],
    granules?: HarmonyGranule[],
  ): void {
    const variables = vars ? vars.map(({ umm, meta }) => ({
      id: meta['concept-id'],
      name: umm.Name,
      fullPath: umm.Name,
    })) : undefined;
    this.model.sources.push({ collection, variables, granules });
  }

  /**
   * Returns the CRS into which the data should be transformed
   *
   * @returns The CRS into which the data should be transformed
   */
  get crs(): string {
    return this.model.format.crs;
  }

  /**
   * Sets the CRS into which the data should be transformed
   */
  set crs(crs: string) {
    this.model.format.crs = crs;
  }

  /**
   * Returns an object of SRS (CRS) transform information with keys proj4, wkt, and epsg (if
   * available).
   */
  get srs(): SRS {
    const { srs } = this.model.format;
    if (!srs) return null;
    return this.model.format.srs;
  }

  /**
   * Sets the SRS (CRS) transform information.
   */
  set srs(srs: SRS) {
    this.model.format.srs = srs;
  }

  /**
   * Returns true if the service output should be transparent where there is no data (if possible)
   *
   * @returns true if the service output should be transparent where there is no data
   */
  get isTransparent(): boolean {
    return this.model.format.isTransparent;
  }

  /**
   * Sets the flag indicating whether the service output should be transparent where there is no
   * data, if possible.  True if so, false otherwise.
   *
   * @param isTransparent - true if the output should be transparent where there is no data
   */
  set isTransparent(isTransparent: boolean) {
    this.model.format.isTransparent = isTransparent;
  }

  /**
   * Returns the mime type which the service should provide as its output format, e.g. "image/tiff"
   *
   * @returns the mime type which the service should provide as its output format
   */
  get outputFormat(): string {
    return this.model.format.mime;
  }

  /**
   * Sets the mime type which the service should provide as its output format, e.g. "image/tiff"
   *
   * @param mime - the mime type to use as an output format
   */
  set outputFormat(mime: string) {
    this.model.format.mime = mime;
  }

  /**
   * Sets the requested dots-per-inch resolution for image output.
   *
   * @param dpi - The DPI resolution for image output
   */
  set outputDpi(dpi: number) {
    this.model.format.dpi = dpi;
  }

  /**
   * Returns the scale extent which the service should use.
   *
   * @returns the scale extent
   */
  get scaleExtent(): object {
    return this.model.format.scaleExtent;
  }

  /**
   * Sets the scale extent which the service should use.
   *
   * @param scaleExtent - the scale extent
   * Example: `{ x: { min: 0, max: 5 }, y: { min: 5, max: 15} }`
   *
   */
  set scaleExtent(scaleExtent: object) {
    this.model.format.scaleExtent = scaleExtent;
  }

  /**
   * Returns the scale size which the service should use.
   *
   * @returns the scale size, e.g. `{ x: 2, y: 1 }`
   */
  get scaleSize(): { x: number; y: number } {
    return this.model.format.scaleSize;
  }

  /**
   * Sets the scale size which the service should use, e.g. `{ x: 2, y: 1 }`
   *
   * @param scaleSize - the scale size which the service should use.
   */
  set scaleSize(scaleSize: { x: number; y: number }) {
    this.model.format.scaleSize = scaleSize;
  }

  /**
   * Returns interpolation method the service should use, e.g. "bilinear"
   *
   * @returns the interpolation method which the service should use
   */
  get interpolationMethod(): string {
    return this.model.format.interpolation;
  }

  /**
   * Sets the interpolation method the service should use, e.g. "bilinear"
   *
   * @param interpolationMethod - the interpolation method which the service should use
   */
  set interpolationMethod(interpolationMethod: string) {
    this.model.format.interpolation = interpolationMethod;
  }

  /**
   * Sets the bounding rectangle to be used for spatial subsetting, an array of 4 coordinates:
   *   [ East, South, West, North ]
   *
   * @param bbox - The subsetting bounding rectangle, [ East, South, West, North ]
   */
  set boundingRectangle(bbox: Array<number>) {
    this.model.subset.bbox = bbox;
  }

  /**
   * Gets the bounding rectangle to be used for spatial subsetting, an array of 4 coordinates:
   *   [ East, South, West, North ]
   *
   * @returns The subsetting bounding rectangle, [ East, South, West, North ]
   */
  get boundingRectangle(): Array<number> {
    return this.model.subset.bbox;
  }

  /**
   * Sets the object store URI to the geojson shape used for spatial subsetting
   *
   * @param geojsonUri - A URI to the geojson shape
   */
  set geojson(geojsonUri: string) {
    this.model.subset.shape = { type: 'application/geo+json', href: geojsonUri };
  }

  /**
   * Gets the object store URI for the geojson shape used for spatial subsetting
   *
   * @returns A URI to the geojson shape
   */
  get geojson(): string {
    return this.model.subset.shape && this.model.subset.shape.href;
  }

  /**
   * Returns the temporal range to be acted upon by services where each time
   * is expressed in RFC-3339 format
   *
   * @returns The temporal range with two keys start and end
   */
  get temporal(): TemporalStringRange {
    const { temporal } = this.model;
    if (!temporal) return null;
    return temporal;
  }

  /**
   * Sets the temporal range to be acted upon by services, `{ start, end }`, storing each time
   * as a string expressed in RFC-3339 format
   *
   * @param The - [ start, end ] temporal range
   */
  set temporal(temporalRange: TemporalStringRange) {
    const { start, end } = temporalRange;
    this.model.temporal = {};
    if (start) {
      this.model.temporal.start = (typeof start === 'string') ? start : (start as Date).toISOString();
    }
    if (end) {
      this.model.temporal.end = (typeof end === 'string') ? end : (end as Date).toISOString();
    }
  }

  /**
   * Returns the requested width of the output file in pixels
   *
   * @returns the requested width of the output file in pixels
   */
  get outputWidth(): number {
    return this.model.format.width;
  }

  /**
   * Sets the requested width of the output file in pixels
   *
   * @param width - the requested width of the output file in pixels
   */
  set outputWidth(width: number) {
    this.model.format.width = width;
  }

  /**
   * Returns the requested height of the output file in pixels
   *
   * @returns the requested height of the output file in pixels
   */
  get outputHeight(): number {
    return this.model.format.height;
  }

  /**
   * Sets the requested height of the output file in pixels
   *
   * @param height - the requested height of the output file in pixels
   */
  set outputHeight(height: number) {
    this.model.format.height = height;
  }

  /**
   * Gets the EDL username of the user requesting the service
   *
   * @returns The EDL username of the service invoker
   */
  get user(): string {
    return this.model.user;
  }

  /**
   * Sets the EDL username of the user requesting the service
   *
   * @param user - The EDL username of the service invoker
   */
  set user(user: string) {
    this.model.user = user;
  }

  /**
   * Gets the EDL token of the user requesting the service
   *
   * @returns The EDL token of the service invoker
   */
  get accessToken(): string {
    return this.model.accessToken;
  }

  /**
   * Sets the EDL token of the user requesting the service. Calling the
   * getter will return the encrypted token as the default behavior. This
   * is to ensure that the token is encrypted when serialized and that the
   * unencrypted token is not accidentally serialized, written to logs, etc.
   * To get the original token, use the the `unencryptedAccessToken` method.
   *
   * @param user - The EDL token of the service invoker
   */
  set accessToken(accessToken: string) {
    this.model.accessToken = accessToken ? this.encrypter(accessToken) : accessToken;
  }

  /**
   * Gets the decrypted EDL token of the user requesting the service
   *
   * @returns The unencrypted EDL token of the service invoker
   */
  get unencryptedAccessToken(): string {
    return this.model.accessToken ? this.decrypter(this.accessToken) : this.model.accessToken;
  }

  /**
   * Gets the URL to which data services should call back when they have completed
   *
   * @returns The callback URL data services should send results to
   */
  get callback(): string {
    return this.model.callback;
  }

  /**
   * Sets the URL to which data services should call back when they have completed
   *
   * @param value - The callback URL data services should send results to
   */
  set callback(value: string) {
    this.model.callback = value;
  }

  /**
   * Gets the Client ID that is submitting the request
   *
   * @returns The Client ID that is submitting the request
   */
  get client(): string {
    return this.model.client;
  }

  /**
   * Sets the Client ID that is submitting the request
   *
   * @param value - The Client ID that is submitting the request
   */
  set client(value: string) {
    this.model.client = value;
  }

  /**
   * Gets whether the service is being invoked synchronously or asynchronously from
   * the perspective of the end user.
   *
   * @returns isSynchronous
   */
  get isSynchronous(): boolean {
    return this.model.isSynchronous;
  }

  /**
   * Sets whether the service is being invoked synchronously or asynchronously from
   * the perspective of the end user.
   *
   * @param value - The synchronous flag
   */
  set isSynchronous(value: boolean) {
    this.model.isSynchronous = value;
  }

  /**
   * Gets the UUID associated with this request.
   *
   * @returns UUID associated with this request.
   */
  get requestId(): string {
    return this.model.requestId;
  }

  /**
   * Sets the UUID associated with this request.
   *
   * @param value - UUID associated with this request.
   */
  set requestId(value: string) {
    this.model.requestId = value;
  }

  /**
   * Gets the staging location URL for data produced by this request
   *
   * @returns the staging location URL
   */
  get stagingLocation(): string {
    return this.model.stagingLocation;
  }

  /**
   * Sets the staging location URL for data produced by this request
   *
   * @param value - the staging location URL
   */
  set stagingLocation(value: string) {
    this.model.stagingLocation = value;
  }

  /**
   *  Returns a deep copy of this operation
   *
   * @returns a deep copy of this operation
   */
  clone(): DataOperation {
    return new DataOperation(_.cloneDeep(this.model));
  }

  /**
   * Returns a JSON string representation of the data operation serialized according
   * to the provided JSON schema version ID (default: highest available)
   *
   * @param version - The version to serialize
   * @returns The serialized data operation in the requested version
   * @throws TypeError - If validate is `true` and validation fails, or if version is not provided
   * @throws RangeError - If the provided version cannot be serialized
   */
  serialize(version: string): string {
    if (!version) {
      throw new TypeError('Schema version is required to serialize DataOperation objects');
    }

    let toWrite = _.cloneDeep(this.model);

    // To be fixed by HARMONY-203 to not default to TIFF
    toWrite.format.mime = toWrite.format.mime || 'image/tiff';
    let matchingSchema = null;
    for (const schemaVersion of schemaVersions()) {
      if (schemaVersion.version === version) {
        matchingSchema = schemaVersion;
        break;
      }
      if (!schemaVersion.down) {
        break;
      }
      toWrite = schemaVersion.down(toWrite);
    }

    if (!matchingSchema) {
      throw new RangeError(`Unable to produce a data operation with version ${version}`);
    }

    toWrite.version = version;
    const validatorInstance = validator();
    const valid = validatorInstance.validate(version, toWrite);
    if (!valid) {
      logger.error(`Invalid JSON: ${JSON.stringify(toWrite)}`);
      throw new TypeError(`Invalid JSON produced: ${JSON.stringify(validatorInstance.errors)}`);
    }

    return JSON.stringify(toWrite);
  }
}
