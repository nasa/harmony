import DataOperation, { TemporalStringRange } from '../../../models/data-operation';
import { ParameterParseError } from '../../../util/parameter-parsing-helpers';
import HarmonyRequest from '../../../models/harmony-request';
import { parseAcceptHeader } from '../../../util/content-negotiation';

const unbounded_datetime = '..';

/**
 * Given a bbox value, parse it into a list of numbers after performing validations
 *
 * @param value - bbox query parameter value
 * @returns An array of 4 numbers corresponding to the bbox definition,
 * in most cases the sequence of minimum longitude, minimum latitude,
 * maximum longitude and maximum latitude.
 */
export function parseBbox(value: string): number[] | null {
  if (value) {
    const bbox: number[] = (value as string).split(',').map(Number);
    if (bbox.length == 4) {
      return bbox;
    } else if (bbox.length == 6) {
      return [bbox[0], bbox[1], bbox[3], bbox[4]];
    } else {
      throw new ParameterParseError('Parameter "bbox" can only have 4 or 6 numbers.');
    }
  }
}

/**
 * Given a datetime value, either a date-time or an interval.
 * Date and time expressions adhere to RFC 3339.
 * Intervals may be bounded or half-bounded (double-dots at start or end)
 * @param value - datetime query parameter value
 * @returns TemporalStringRange object with the parse start and end values
 */
export function parseDatetime(value: string): TemporalStringRange {
  const temporal: TemporalStringRange = {};
  if (value) {
    const datetime: string[] = (value as string).split('/');
    // TODO: need validation of the parsed datetime
    // TODO: need to handle single date time, make a small datetime range??
    if (datetime[0] && datetime[0] !== unbounded_datetime) {
      temporal.start = datetime[0];
    }
    if (datetime[1] && datetime[1] !== unbounded_datetime) {
      temporal.end = datetime[1];
    }
  }

  return temporal;
}

/**
 * Set the output format for the request.
 *
 * @param operation - the DataOperation for the request
 * @param query - the query for the request
 * @param req - The request
 */
export function handleFormat(
  operation: DataOperation,
  query: Record<string, string>,
  req: HarmonyRequest): void {
  if (query.f) {
    operation.outputFormat = query.f;
  } else if (req.headers.accept) {
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    req.context.requestedMimeTypes = acceptedMimeTypes
      .map((v: { mimeType: string }) => v.mimeType)
      .filter((v) => v);
  }
}