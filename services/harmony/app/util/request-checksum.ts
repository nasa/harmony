import * as crypto from 'crypto';

import HarmonyRequest from '../models/harmony-request';

// Bump when the canonicalization or hashing below changes, so that checksums computed by an
// older version of the code are never treated as matching ones computed by this version.
const CHECKSUM_VERSION = 'v1';

// Query parameters that change how a job is run but not the results it produces
const excludedParams = ['skippreview'];

// Query parameters whose spatial content reaches the checksum through the normalized GeoJSON
// hash instead of their raw text, so that the same shape dedupes across input formats
const spatialParams = ['coords'];

/**
 * Serializes a value to JSON with object keys in sorted order, so that two structurally equal
 * values always produce the same string regardless of the order their keys were assigned.
 *
 * @param value - the value to serialize
 * @returns the canonical JSON representation of the value
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Returns a checksum of the given normalized GeoJSON shape, suitable for storing on the request
 * context and folding into a request checksum. Callers must pass GeoJSON that has already been
 * through `normalizeGeoJson`, so that shapes differing only in coordinate precision, longitude
 * range, winding order, or source file format produce the same value.
 *
 * @param geoJson - the normalized GeoJSON shape
 * @returns a hex checksum of the shape
 */
export function hashGeoJson(geoJson: object): string {
  return crypto.createHash('sha256').update(stableStringify(geoJson)).digest('hex');
}

/**
 * Returns the canonical form of a request's query parameters: one `name=value` entry per value,
 * with names lowercased, parameters that do not affect results removed, and the whole list
 * sorted so that the order the caller supplied them in does not matter.
 *
 * @param query - the request query, with any body parameters already merged in
 * @param hasSpatialHash - whether a normalized shape checksum is being folded in separately
 * @returns the sorted list of canonical parameter entries
 */
function canonicalParams(query: object, hasSpatialHash: boolean): string[] {
  const entries: string[] = [];
  for (const [rawName, rawValue] of Object.entries(query || {})) {
    const name = rawName.toLowerCase();
    if (excludedParams.includes(name)) continue;
    if (hasSpatialHash && spatialParams.includes(name)) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      entries.push(`${name}=${stableStringify(value)}`);
    }
  }
  return entries.sort();
}

/**
 * Returns a checksum identifying the results a request is asking for. Two requests by the same
 * user with the same checksum will produce the same output, so the second can be served by the
 * job the first created.
 *
 * The checksum covers the request path and its parameters, plus the shape of any shapefile,
 * GeoJSON, KML, or WKT the request supplied. It deliberately excludes the protocol and host, the
 * order and letter case of parameter names, and parameters listed in `excludedParams`.
 *
 * @param req - the request to compute a checksum for
 * @returns a versioned hex checksum of the request
 */
export function computeRequestChecksum(req: HarmonyRequest): string {
  const spatialHash = req.context?.spatialHash;
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
  const parts = [
    `path=${path}`,
    ...canonicalParams(req.query, !!spatialHash),
  ];
  if (spatialHash) {
    parts.push(`shape=${spatialHash}`);
  }
  const digest = crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
  return `${CHECKSUM_VERSION}:${digest}`;
}
