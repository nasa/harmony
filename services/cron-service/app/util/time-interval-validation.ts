import { registerDecorator, ValidationArguments } from 'class-validator';

import logger from '../../../harmony/app/util/log';

/**
 *  Check that an entry is a valid time interval
 *
 * @param value - the value of the property being tested
 * @returns an error message if validation fails, null otherwise
 */
export function validateTimeInterval(value: unknown): string {
  if (typeof value != 'string') {
    return 'time interval entries must be strings';
  }
  if (value.split(' ').length > 2) {
    return 'Only one time interval may be specified.';
  }
  if (!/^\d+\s+(MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?$/i.test(value)) {
    return 'Invalid time interval format. Use format like "1 MINUTE" or "2 HOURS".';
  }
  const [amount, _] = value.split(/\s+/);
  const numAmount = parseInt(amount, 10);
  if (isNaN(numAmount) || numAmount <= 0) {
    return 'Time interval amount must be a positive integer.';
  }

  return null;
}

/**
 * Creates a custom decorator that validates a time interval entry
 */
export function IsTimeInterval() {
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isTimeInterval',
      target: object.constructor,
      propertyName: propertyName,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          const errMsg = validateTimeInterval(value);
          if (errMsg) {
            logger.error(`${propertyName.replace(/([A-Z])/g, '_$1').toUpperCase()} must be a valid time interval`);
            logger.error(errMsg);
            return false;
          }
          return true;
        },
      },
    });
  };
}