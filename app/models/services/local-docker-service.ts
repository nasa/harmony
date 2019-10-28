const process = require('process');
const { spawn } = require('child_process');

const BaseService = require('./base-service');
const log = require('../../util/log');


/**
 * Sets up logging of stdin / stderr and the return code of child.
 *
 * @param {Process} child The child process
 * @returns {void}
 */
function logProcessOutput(child) {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    process.stdout.write(`child stdout: ${data}`);
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data) => {
    process.stderr.write(`child stderr: ${data}`);
  });

  child.on('close', (code) => {
    log.info(`closing code: ${code}`);
  });
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

    log.info(this.params);
    this.operation.callback = this.operation.callback.replace('localhost', process.env.CALLBACK_HOST || 'host.docker.internal');
    let dockerParams = ['run', '--rm', '-t'];

    for (const variable of Object.keys(this.params.env)) {
      dockerParams = dockerParams.concat('-e', [variable, this.params.env[variable]].join('='));
    }

    dockerParams = dockerParams.concat(
      this.params.image,
      '--harmony-action', 'invoke',
      '--harmony-input', this.operation.serialize(),
    );
    log.info(dockerParams);
    const child = spawn('docker', dockerParams);
    logProcessOutput(child);
  }
}

module.exports = LocalDockerService;
