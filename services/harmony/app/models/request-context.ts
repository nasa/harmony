import { Logger } from 'winston';
import { ServiceConfig } from './services/base-service';
import { CmrCollection } from '../util/cmr';

interface ShapefileObject {
  typeName?: string;
}
/**
 * Contains additional information about a request
 */
export default class RequestContext {
  id?: string;

  logger?: Logger;

  requestedMimeTypes?: Array<string>;

  shapefile?: ShapefileObject;

  frontend?: string;

  /**
   * True if the request is from a verified admin making a request against an admin interface
   * (/admin/*)
   */
  isAdminAccess?: boolean;

  /**
   * True if the request is from a verified core permissions member making a request against a core interface
   * (/core/*)
   */
  isCoreAccess?: boolean;

  serviceConfig?: ServiceConfig<unknown>;

  messages?: string[];

  startTime?: Date;

  requestedVariables?: string[];

  collectionIds?: string[];

  collections?: CmrCollection[];

  /**
   * Creates an instance of RequestContext.
   *
   * @param id - request identifier
   */
  constructor(id) {
    this.id = id;
    this.isAdminAccess = false;
    this.messages = [];
    this.startTime = new Date();
  }
}
