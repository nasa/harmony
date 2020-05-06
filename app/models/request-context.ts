import { Logger } from 'winston';

/**
 * Contains additional information about a request
 *
 * @class RequestContext
 */
export default class RequestContext {
  id: string;

  logger: Logger;

  requestedMimeTypes: Array<string>;

  shapefile: object;

  frontend: string;


  /**
   * Creates an instance of RequestContext.
   *
   * @param {String} id request identifier
   * @memberof RequestContext
   */
  constructor(id) {
    this.id = id;
  }
}
