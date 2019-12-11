const process = require('process');
const { spawn } = require('child_process');
const axios = require('axios');
const querystring = require('querystring');

const BaseService = require('./base-service');
const { isUrlBound } = require('../../backends/service-response');

const blankStrings = ['\n', '\r', ''];

/**
 * Returns true if the string has no useful content such as an empty
 * string, or a newline character.
 *
 * @param {String} line The string to return
 * @returns {boolean} true if the passed in string is empty
 */
function blank(line) {
  return blankStrings.includes(line);
}

/**
 * Helper function to log messages from stderr or stdout in a format
 * that helps support metrics extraction.
 *
 * @param {Stream} stream The stream of stderr or stdout from a process
 * @param {Logger} logger The logger associated with this request
 * @param {String} streamType Either 'stdout' or 'stderr'
 * @param {String} field The name of the field to use in the JSON log message.
 * @returns {void}
 */
function processLogMessagesFromStream(stream, logger, streamType, field) {
  const lines = stream.toString().split('\n');
  const message = `child ${streamType}`;
  lines.forEach((line) => {
    if (!blank(line)) {
      try {
        const jsonMessage = JSON.parse(line);
        logger.info(message, { [field]: jsonMessage });
      } catch (e) {
        logger.info(message, { [field]: line });
      }
    }
  });
}

/**
 * Sets up logging of stdin / stderr and the return code of child.
 *
 * @param {Process} child The child process
 * @param {Logger} logger The logger associated with this request
 * @returns {void}
 */
function logProcessOutput(child, logger) {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    processLogMessagesFromStream(data, logger, 'stdout', 'dockerOut');
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data) => {
    processLogMessagesFromStream(data, logger, 'stderr', 'dockerErr');
  });
}

/**
 * Calls the callback URL with an error response indicating the child process crashed.
 *
 * @param {String} callbackUrl The callback URL for the current request
 * @param {Logger} logger The logger associated with this request
 * @returns {void}
 */
function childProcessAborted(callbackUrl, logger) {
  logger.error('Child did not hit the callback URL. Returning service request failed with an unknown error to the user.');
  const callbackRequest = axios.create({
    baseURL: `${callbackUrl}/response`,
  });
  const querystr = querystring.stringify({ error: 'Service request failed with an unknown error.' });
  callbackRequest.post(`?${querystr}`);
}

/**
 * Represents a service that is invoked using the Docker CLI on the Node process' machine
 *
 * @class LocalDockerService
 * @extends {BaseService}
 */
class LocalDockerService extends BaseService {
  /**
   * Invoke the service at the local command line, passing --harmony-action and --harmony-input
   * parameters to the Docker container
   *
   * @memberof LocalDockerService
   * @returns {void}
   */
  _invokeAsync() {
    // DELETE ME: Hacks for PO.DAAC having granule metadata with missing files.  They will fix.
    if (this.config.name === 'podaac-cloud/l2-subsetter-service') {
      this.operation.sources[0].granules = this.operation.sources[0].granules.slice(5);
    }
    // END DELETE ME

    this.logger.info(this.params);
    const originalCallback = this.operation.callback;
    this.operation.callback = this.operation.callback.replace('localhost', process.env.CALLBACK_HOST || 'host.docker.internal');
    let dockerParams = ['run', '--rm', '-t'];

    for (const variable of Object.keys(this.params.env)) {
      dockerParams = dockerParams.concat('-e', [variable, this.params.env[variable]].join('='));
    }

    dockerParams = dockerParams.concat(
      this.params.image,
      '--harmony-action', 'invoke',
      '--harmony-input', this.operation.serialize(this.config.data_operation_version),
    );
    this.logger.info(dockerParams.join(' '));
    const child = spawn('docker', dockerParams);
    logProcessOutput(child, this.logger);

    child.on('exit', ((code, signal) => {
      this.logger.info(`child process exited with code ${code} and signal ${signal}`);
      if (isUrlBound(originalCallback)) {
        childProcessAborted(originalCallback, this.logger);
      }
    }));
  }
}

module.exports = LocalDockerService;
