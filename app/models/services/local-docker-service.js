const process = require('process');
const { spawn } = require('child_process');

const BaseService = require('./base-service');
const log = require('../../util/log');


/**
 * Sets up logging of stdin / stderr and the return code of child.
 *
 * @param {*} child The child process
 * @returns {undefined}
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

class LocalDockerService extends BaseService {
  _invokeAsync() {
    console.log(this.params);
    this.operation.callback = this.operation.callback.replace('localhost', process.env.callback_host || 'host.docker.internal');
    let dockerParams = ['run', '--rm', '-t'];

    for (const variable of Object.keys(this.params.env)) {
      dockerParams = dockerParams.concat('-e', [variable, this.params.env[variable]].join('='));
    }

    dockerParams = dockerParams.concat(
      this.params.image,
      '--harmony-action', 'invoke',
      '--harmony-input', this.operation.serialize(),
    );
    console.log(dockerParams);
    const child = spawn('docker', dockerParams);
    logProcessOutput(child);
  }
}

module.exports = LocalDockerService;
