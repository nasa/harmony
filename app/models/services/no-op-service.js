const BaseService = require('./base-service');
const Job = require('../job');

const noOpMessage = 'Returning direct download links, no transformation was performed because no known service exists to perform this transformation on the data.';

/**
 * Service implementation that does not actually perform any transformation
 * to data files. For each granule requested return just the download links
 * in a response format similar to the asynchronous job status response.
 *
 * @class NoOpService
 * @extends {BaseService}
 */
class NoOpService extends BaseService {
  /**
   * Generates a response with a list of download links as provided by the CMR.
   *
   * @returns {Object} Job status response
   * @memberof HttpService
   */
  invoke() {
    const now = new Date();
    const granules = this.operation.sources.flatMap((source) => source.granules);
    const links = granules.map((granule) => ({ title: granule.id, href: granule.url }));
    const message = this.truncationMessage ? `${noOpMessage} ${this.truncationMessage}` : noOpMessage;
    const job = new Job({
      username: this.operation.user,
      requestId: this.operation.requestId,
      status: Job.statuses.SUCCESSFUL,
      progress: 100,
      createdAt: now,
      updatedAt: now,
      message,
      links,
      originatingRequest: this.originatingRequestUrl,
    });

    const response = {
      headers: { contentType: 'application/json' },
      statusCode: 200,
      content: job.serialize(this.config.harmonyRoot),
    };

    return response;
  }
}

module.exports = NoOpService;
