import { Job, JobStatus } from 'models/job';
import BaseService from './base-service';
import InvocationResult from './invocation-result';

/**
 * Service implementation that does not actually perform any transformation
 * to data files. For each granule requested return just the download links
 * in a response format similar to the asynchronous job status response.
 *
 * @class NoOpService
 * @extends {BaseService}
 */
export default class NoOpService extends BaseService<void> {
  message: string;

  /**
   * Creates an instance of the NoOpService. The NoOpService will include a message
   * to indicate the reason the NoOpService is being used rather than a transformation.
   *
   * @param {object} config The service configuration from config/services.yml
   * @param {DataOperation} operation The data operation being requested of the service
   * @memberof BaseService
   */
  constructor(config, operation) {
    super(config, operation);
    this.message = `Returning direct download links because ${config.message}.`;
  }

  /**
   * Generates a response with a list of download links as provided by the CMR.
   *
   * @param logger - The logger associated with this request
   * @param harmonyRoot - The harmony root URL
   * @param requestUrl - The URL the end user invoked
   * @returns a promise with the Job status response
   */
  async invoke(logger, harmonyRoot, requestUrl): Promise<InvocationResult> {
    const now = new Date();
    const granuleLists = this.operation.sources.map((source) => source.granules);
    const granules = granuleLists.reduce((acc, val) => acc.concat(val), []);
    const links = granules.map((granule) => ({ title: granule.id, href: granule.url, rel: 'data' }));
    const message = this.warningMessage ? `${this.message} ${this.warningMessage}` : this.message;
    let job = new Job({
      username: this.operation.user,
      requestId: this.operation.requestId,
      status: JobStatus.SUCCESSFUL,
      progress: 100,
      createdAt: now,
      updatedAt: now,
      message,
      links,
      request: requestUrl,
    });
    job = job.serialize(harmonyRoot);
    // No-op service response should look like a job, but doesn't actually create one
    // so do not include a jobID in the response.
    delete job.jobID;
    const response = {
      error: null,
      redirect: null,
      stream: null,
      onComplete: null,
      headers: { contentType: 'application/json' },
      statusCode: 200,
      content: JSON.stringify(job),
    };

    return response;
  }
}
