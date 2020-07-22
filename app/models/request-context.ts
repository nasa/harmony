import { Logger } from 'winston';
import { ServiceConfig } from './services/base-service';

/**
 * Contains additional information about a request
 */
export default class RequestContext {
  id?: string;

  logger?: Logger;

  requestedMimeTypes?: Array<string>;

  shapefile?: object;

  frontend?: string;

  /**
   * True if the request is from a verified admin making a request against an admin interface
   * (/admin/*)
   */
  isAdminAccess?: boolean;

  serviceConfig?: ServiceConfig<unknown>;

  /**
   * Creates an instance of RequestContext.
   *
   * @param id - request identifier
   */
  constructor(id) {
    this.id = id;
    this.isAdminAccess = false;
  }
}
