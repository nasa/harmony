import { Job } from '../../app/models/job';
import TurboService from '../../app/models/services/turbo-service';


/**
 * Extends TurboService for testing purposes.
 */
export class TestTurboService extends TurboService {
  /**
   * Calls _createJob which creates a job from a service and its operation.
   * @param requestUrl - The URL the end user invoked
   * @returns The created job
   */
  createJob(
    requestUrl: string,
  ): Job {
    return this._createJob(requestUrl);
  }
}