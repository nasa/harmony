/**
 * CRS parsing without gdal-async.
 *
 * Strategy:
 *  - proj4          : parses/validates proj4 strings and a handful of built-in EPSG codes
 *  - epsg-index     : provides proj4 + WKT strings for 8 000+ EPSG codes
 *  - Reverse lookup : normalised proj4 string → EPSG code (so "+proj=longlat …" → 4326)
 *  - WKT extraction : pulls the top-level AUTHORITY["EPSG","NNNN"] tag from WKT input
 *
 * Supported input formats (mirrors GDAL SpatialReference.fromUserInput):
 *   EPSG:4326 / EPSGA:4326
 *   CRS:84
 *   www.opengis.net PURL  (handled by the caller, but also handled here)
 *   urn:ogc:def:crs:EPSG::NNNN
 *   +proj=… proj4 string
 *   OGC WKT 1 / WKT 2 (GEOGCS[…], PROJCS[…], GEOGCRS[…], …)
 *   Well-known names: WGS84, NAD83, NAD27, WGS72
 */

import * as fs from 'fs';
import * as path from 'path';
import proj4 from 'proj4';

import log from '../log';

// epsg-index ships `all.json` as a plain JSON data file alongside an ESM index.
// Read in that file in order to create the EPSG index
const epsgIndexPath = path.join(
  path.dirname(require.resolve('epsg-index/package.json')),
  'all.json',
);

const epsgIndex: Record<string, { proj4: string; wkt: string; name: string }> =
  JSON.parse(fs.readFileSync(epsgIndexPath, 'utf8'));

/**
 * Register every EPSG code from epsg-index into proj4 so that
 * proj4.defs('EPSG:NNNN') works for all 8k+ codes.
 */
function registerAllEpsgCodes(): void {
  const broken_defs = [];
  for (const [code, def] of Object.entries(epsgIndex)) {
    try {
      proj4.defs(`EPSG:${code}`, def.proj4);
    } catch {
      broken_defs.push(code);
    }
  }
  if (broken_defs.length > 0) {
    log.warn(`There are ${broken_defs.length} codes not handled: ${broken_defs}`);
  }
}

// Called at application start up
registerAllEpsgCodes();

/**
 * Normalise a proj4 string so semantically-equivalent strings compare equal.
 * Rules:
 *   - lower-case everything
 *   - split on whitespace, keep only "+key=value" tokens
 *   - drop "+type=crs", "+no_defs", "+wktext" (pure metadata)
 *   - sort tokens alphabetically
 *
 * @param str - The proj4 string to normalise
 * @returns The normalised proj4 string
 */
function normalizeProj4(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(
      (t) =>
        t.startsWith('+') &&
        !t.startsWith('+type=') &&
        t !== '+no_defs' &&
        t !== '+wktext',
    )
    .sort()
    .join(' ');
}

/** Reverse-lookup map: normalised proj4 string → EPSG numeric string */
const proj4ToEpsgCode: Map<string, string> = new Map();
for (const [code, def] of Object.entries(epsgIndex)) {
  if (def.proj4) {
    const key = normalizeProj4(def.proj4);
    if (!proj4ToEpsgCode.has(key)) {
      proj4ToEpsgCode.set(key, code);
    }
  }
}

// ─── well-known name aliases ──────────────────────────────────────────────────

const WELL_KNOWN_NAMES: Record<string, string> = {
  WGS84: '4326',
  'WGS 84': '4326',
  WGS_84: '4326',
  CRS84: '4326',
  'CRS:84':'4326',
  NAD83: '4269',
  NAD27: '4267',
  WGS72: '4322',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the top-level EPSG code from an OGC WKT string.
 * OGC WKT 1 embeds it as the last AUTHORITY node, e.g.
 *   PROJCS["…", …, AUTHORITY["EPSG","32632"]]
 * OGC WKT 2 uses an ID node, e.g.
 *   PROJCRS["…", …, ID["EPSG",32632]]
 *
 * @param wkt - The WKT string to extract the EPSG code from
 * @returns The EPSG numeric string, or null if not found
 */
function extractEpsgFromWkt(wkt: string): string | null {
  // WKT1: AUTHORITY["EPSG","NNNN"] as the very last node
  const wkt1 = /AUTHORITY\["EPSG","(\d+)"\]\s*\]\s*$/.exec(wkt);
  if (wkt1) return wkt1[1];

  // WKT2: ID["EPSG",NNNN] as the very last node
  const wkt2 = /ID\["EPSG",(\d+)\]\s*\]\s*$/.exec(wkt);
  if (wkt2) return wkt2[1];

  return null;
}

/**
 * Strip "+type=crs" appended by epsg-index — GDAL's toProj4() never included it.
 *
 * @param str - The proj4 string to clean
 * @returns The proj4 string with "+type=crs" removed
 */
function cleanProj4(str: string): string {
  return str.replace(/\s*\+type=crs\b/, '').trim();
}

/**
 * Given an EPSG numeric string, return an Object with proj4String, wkt from epsg-index,
 * or null if the code is unknown.
 *
 * @param code - The EPSG numeric string to look up
 * @returns An object containing the proj4 string and WKT, or null if not found
 */
function lookupEpsg(code: string): { proj4String: string; wkt: string } | null {
  const entry = epsgIndex[code];
  if (!entry) return null;
  return { proj4String: cleanProj4(entry.proj4), wkt: entry.wkt };
}

// ─── public API ──────────────────────────────────────────────────────────────

export interface SpatialRefResult {
  /** proj4 string, e.g. "+proj=longlat +datum=WGS84 +no_defs" */
  proj4String: string;

  /** OGC WKT string, or null for custom proj4 strings not in EPSG registry */
  wkt: string | null;

  /**
   * "EPSG:NNNN" authority string when the code is known, otherwise "".
   * Matches the `epsg` field behaviour from the original parseCRS.
   */
  epsg: string;
}

/**
 * Replacement for `SpatialReference.fromUserInput(input)` from gdal-async.
 *
 * Accepts the same wide range of CRS descriptions:
 *   EPSG codes, CRS:84, OGC URNs, opengis.net PURLs, well-known names,
 *   proj4 strings, OGC WKT 1 / WKT 2.
 *
 * @param input - The CRS string to parse
 * @returns The canonical proj4 string, WKT, and EPSG authority string
 * @throws Error - if the input cannot be parsed
 */
export function fromUserInput(input: string): SpatialRefResult {
  const s = input.trim();

  // 1. Well-known short names (WGS84, NAD83, …)
  {
    const code = WELL_KNOWN_NAMES[s] ?? WELL_KNOWN_NAMES[s.toUpperCase()];
    if (code) {
      const entry = lookupEpsg(code);
      if (entry) {
        return {
          proj4String: entry.proj4String,
          wkt: entry.wkt,
          epsg: `EPSG:${code}`,
        };
      }
    }
  }

  // 2. EPSG:NNNN  /  EPSGA:NNNN
  {
    const m = /^epsg[a]?[ ]?:[ ]?(\d+)$/i.exec(s);
    if (m) {
      const code = m[1];
      const entry = lookupEpsg(code);
      if (entry) {
        return { proj4String: entry.proj4String, wkt: entry.wkt, epsg: `EPSG:${code}` };
      }
      // Code not in our index – try proj4's built-ins (UTM zones etc.)
      const p4def = proj4.defs(`EPSG:${code}`);
      if (p4def) {
        const proj4String: string = cleanProj4((p4def as { projStr?: string }).projStr ?? s);
        return { proj4String, wkt: null, epsg: `EPSG:${code}` };
      }
      throw new Error(`Unknown EPSG code: ${code}`);
    }
  }

  // 4. OGC URN  urn:ogc:def:crs:EPSG::NNNN
  {
    const m = /urn:ogc:def:crs:EPSG::(\d+)/i.exec(s);
    if (m) {
      const code = m[1];
      const entry = lookupEpsg(code);
      if (entry) {
        return { proj4String: entry.proj4String, wkt: entry.wkt, epsg: `EPSG:${code}` };
      }
      throw new Error(`Unknown EPSG code from URN: ${code}`);
    }
  }

  // 5. opengis.net PURL  http(s)://www.opengis.net/def/crs/EPSG/0/NNNN
  {
    const m = /www\.opengis\.net\/def\/crs\/EPSG\/0\/(\d+)$/i.exec(s);
    if (m) {
      const code = m[1];
      const entry = lookupEpsg(code);
      if (entry) {
        return { proj4String: entry.proj4String, wkt: entry.wkt, epsg: `EPSG:${code}` };
      }
      throw new Error(`Unknown EPSG code from PURL: ${code}`);
    }
  }

  // 6. proj4 string  (+proj=…)
  if (s.startsWith('+')) {
    // Validate by letting proj4 parse it (throws on invalid input)
    const uid = `_crs_${Math.random().toString(36).slice(2)}`;
    proj4.defs(uid, s);
    const def = proj4.defs(uid) as { projStr?: string } | undefined;
    if (!def) throw new Error(`proj4 could not parse: ${s}`);

    const proj4String: string = cleanProj4(def.projStr ?? s);

    // Try to match to an EPSG code via reverse lookup
    const normalized = normalizeProj4(s);
    const code = proj4ToEpsgCode.get(normalized);
    if (code) {
      const entry = lookupEpsg(code);
      if (entry) {
        return { proj4String: entry.proj4String, wkt: entry.wkt, epsg: `EPSG:${code}` };
      }
    }

    // Custom / unregistered proj4 string – return as-is, no WKT available
    return { proj4String, wkt: null, epsg: '' };
  }

  // 7. OGC WKT 1 or WKT 2  (starts with a keyword like GEOGCS, PROJCS, GEOGCRS, …)
  if (/^[A-Z_]+CS\s*\[|^GEOGCRS\s*\[|^PROJCRS\s*\[|^COMPOUNDCRS\s*\[|^BOUNDCRS\s*\[/i.test(s)) {
    // Try to extract the EPSG code from the AUTHORITY / ID tag first
    const code = extractEpsgFromWkt(s);
    if (code) {
      const entry = lookupEpsg(code);
      if (entry) {
        return { proj4String: entry.proj4String, wkt: entry.wkt, epsg: `EPSG:${code}` };
      }
    }

    // No AUTHORITY tag: parse with proj4 and use the WKT as-is for wkt output
    const uid = `_crs_${Math.random().toString(36).slice(2)}`;
    try {
      proj4.defs(uid, s);
    } catch {
      throw new Error(`Could not parse WKT: ${s.slice(0, 80)}…`);
    }
    const def = proj4.defs(uid) as { projStr?: string } | undefined;
    if (!def) throw new Error(`proj4 could not parse WKT: ${s.slice(0, 80)}…`);

    // proj4 can parse WKT1 but projStr will be undefined (it stores numeric params).
    // We return the original WKT string unchanged as the wkt field, and leave
    // proj4String as the canonical form proj4 understood (no projStr means no string form).
    // Best we can do without a full WKT→proj4 serialiser.
    const proj4String: string = cleanProj4(def.projStr ?? s);
    return { proj4String, wkt: s, epsg: '' };
  }

  throw new Error(`Unrecognised CRS format: ${s}`);
}
