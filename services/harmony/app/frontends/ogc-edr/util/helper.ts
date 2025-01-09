import { TemporalStringRange } from '../../../models/data-operation';
import logger from '../../../util/log';
import { ParameterParseError } from '../../../util/parameter-parsing-helpers';

const unbounded_datetime = '..';

/**
 * Given a bbox value, parse it into a list of numbers after performing validations
 *
 * @param value - bbox query parameter value
 * @returns An array of 4 numbers corresponding to the bbox definition,
 * in most cases the sequence of minimum longitude, minimum latitude,
 * maximum longitude and maximum latitude.
 */
export function parseBbox(value: string | string[] | number[]): number[] | null {
  if (value) {
    try {
      let bbox;
      if (Array.isArray(value)) {
        bbox = value.map(Number);
      } else {
        bbox = value.split(',').map(Number);
      }
      if (bbox.length === 4) {
        return bbox;
      } else if (bbox.length === 6) {
        return [bbox[0], bbox[1], bbox[3], bbox[4]];
      } else if (bbox.length > 0) {
        throw new ParameterParseError('Parameter "bbox" can only have 4 or 6 numbers.');
      }
    } catch (e) {
      if (e instanceof ParameterParseError) {
        throw e;
      } else {
        logger.error(e);
        throw new ParameterParseError('Unable to parse "bbox" parameter');
      }
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
