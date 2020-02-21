const BaseService = require('./base-service');
const Job = require('../job');

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

    const response = {
      headers: { contentType: 'application/json' },
      statusCode: 200,
      content: {
        jobID: this.operation.requestId,
        username: this.operation.user,
        status: Job.statuses.SUCCESSFUL,
        message: this.truncationMessage || 'Returning direct download links, no transformations performed.',
        progress: 100,
        createdAt: now,
        updatedAt: now,
        links,
      },
    };
    return response;
  }
}

module.exports = NoOpService;
