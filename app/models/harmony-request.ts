import { Request } from 'express';
import { CmrCollection } from '../util/cmr';
import RequestContext from './request-context';
import DataOperation from './data-operation';

/**
 * Contains additional information about a request
 */
export default interface HarmonyRequest extends Request {
  context: RequestContext;
  collections: CmrCollection[];
  collectionIds: string[];
  operation: DataOperation;
  user: string;
  accessToken: string;
}
