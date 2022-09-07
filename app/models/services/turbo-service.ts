import _ from 'lodash';
import { Logger } from 'winston';
import { Job } from '../job';
import BaseService from './base-service';
import InvocationResult from './invocation-result';

export interface TurboServiceParams {
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

/**
 * Extends TurboService for testing purposes.
 */
export class TestTurboService extends TurboService {
  /**
   * Calls this._createJob which creates a job from a service and its operation.
   * @param requestUrl - The URL the end user invoked
   * @returns The created job
   */
  createJob(
    requestUrl: string,
  ): Job {
    return this._createJob(requestUrl);
  }
}