import _ from 'lodash';
import { Logger } from 'winston';
import BaseService from './base-service';
import InvocationResult from './invocation-result';


export interface TurboServiceParams {
  argo_url: string;
  namespace: string;
  template: string;
  template_type?: string;
  template_ref?: string;
  embedded_template?: string;
  image_pull_policy?: string;
  query_cmr_image_pull_policy?: string;
  parallelism?: number;
  postBatchStepCount?: number;
  env: { [key: string]: string };
  image?: string;
}

/**
 * Service implementation which invokes a turbo workflow and creates a Job to poll for service
 * updates.
 */
export default class TurboService extends BaseService<TurboServiceParams> {
  /**
   * Invokes a turbo workflow to execute a service request
   *
   *  @param logger - the logger associated with the request
   *  @returns A promise resolving to null
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    return null;

  }
}