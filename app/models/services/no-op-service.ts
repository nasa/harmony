import { Logger } from 'winston';
import { Job, JobStatus } from '../job';
import BaseService from './base-service';
import InvocationResult from './invocation-result';

/**
 * Service implementation that does not actually perform any transformation
 * to data files. For each granule requested return just the download links
 * in a response format similar to the asynchronous job status response.
 *
 */
export default class NoOpService extends BaseService<void> {
  message: string;

  /**
   * Creates an instance of the NoOpService. The NoOpService will include a message
   * to indicate the reason the NoOpService is being used rather than a transformation.
   *
   * @param config - The service configuration from config/services.yml
   * @param operation - The data operation being requested of the service
   */
  constructor(config, operation) {
    super(config, operation);
    const downloadLinkMessage = `Returning direct download links because ${config.message}.`;
    this.message = this.operation.message ? `${downloadLinkMessage} ${this.operation.message}` : downloadLinkMessage;
  }

  /**
   * Does nothing useful, but needed to fulfill the BaseService contract.
   * @returns A promise resolving to a useless result.
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    return {
      onComplete: (_err: Error): void => { },
    };
  }

  /**
   * Generates a response with a list of download links as provided by the CMR.
   *
   * @param logger - The logger associated with this request
   * @param harmonyRoot - The harmony root URL
   * @param requestUrl - The URL the end user invoked
   * @returns a promise with the Job status response
   */
  async invoke(_logger, harmonyRoot, requestUrl): Promise<InvocationResult> {
    const now = new Date();
    const granuleLists = this.operation.sources.map((source) => source.granules);
    const granules = granuleLists.reduce((acc, val) => acc.concat(val), []);
    const links = granules.map((granule) => ({ title: granule.id, href: granule.url, rel: 'data' }));
    let job = new Job({
      username: this.operation.user,
      requestId: this.operation.requestId,
      jobID: this.operation.requestId,
      status: JobStatus.SUCCESSFUL,
      progress: 100,
      createdAt: now,
      updatedAt: now,
      message: this.message,
      collectionIds: this.operation.collectionIds,
      links,
      request: requestUrl,
      numInputGranules: this.operation.cmrHits,
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
