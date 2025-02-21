import { registerDecorator, ValidationArguments } from 'class-validator';
import { CronPattern } from 'croner';

import logger from '../../../harmony/app/util/log';

/**
 *  Check that an entry is a valid crontab schedule
 *
 * @param value - the value of the property being tested
 * @returns an error message if validation fails, null otherwise
 */
export function validateCrontab(value: unknown): string {
  if (typeof value != 'string') {
    return 'crontab entries must be strings';
  }
  try {
    new CronPattern(value);
  } catch (e) {
    return e.message;
  }

  return null;
}

/**
 * Creates a custom decorator that validates a crontab schedule entry
 *
 * @param validationOptions - options passed to internal validation library
 * @returns
 */
export function IsCrontab() {
  return function (object: Object, propertyName: string): void {
    registerDecorator({
      name: 'isCrontab',
      target: object.constructor,
      propertyName: propertyName,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          const errMsg = validateCrontab(value);
          if (errMsg) {
            logger.error(`${propertyName.replace(/([A-Z])/g, '_$1').toUpperCase()} must be a valid crontab specification`);
            logger.error(errMsg);
            return false;
          }
          return true;
        },
      },
    });
  };
}