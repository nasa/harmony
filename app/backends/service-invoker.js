const process = require('process');
const { spawn } = require('child_process');
// const aws = process.env.aws ? require('aws-sdk') : null;
const serviceResponse = require('./service-response');
const { log } = require('../util/log');

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

/**
 * Invokes the given docker image name to run the given operation
 *
 * @param {string} image The name of the docker image (possibly with version) to invoke
 * @param {DataOperation} operation The operation being run
 * @returns {undefined}
 */
function invokeLocalDockerService(image, operation) {
  const op = operation; // We are mutating the operation
  op.callback = op.callback.replace('localhost', 'host.docker.internal');
  const child = spawn('docker', [
    'run', '--rm', '-t',
    '-v', '/Users/pquinn/earthdata/harmony/harmony-gdal:/home', // DELETEME
    //    '-v', `${process.cwd()}:/home`,
    image, 'invoke', op.serialize(),
  ]);
  logProcessOutput(child);
}


/**
 * Invokes the given data operation.
 *
 * @param {DataOperation} operation The operation to invoke
 * @returns {undefined}
 */
function invoke(operation) {
  // Cheat for now, because gdal is the only valid backend.  We will have to add more
  // and then add service selection in the future
  // if (aws) {
  // invokeFargateDockerService('harmony/gdal');
  // } else {
  invokeLocalDockerService(process.env.gdalTaskDefinition, operation);
  // }
}

/**
 * Copies the header with the given name from the given request to the given response
 *
 * @param {http.IncomingMessage} req The request to copy from
 * @param {http.ServerResponse} res The response to copy to
 * @param {string} header The name of the header to set
 * @returns {undefined}
 */
function copyHeader(req, res, header) {
  res.set(header, req.get(header));
}

/**
 * Translates the given request sent by a backend service into the given
 * response sent to the client.
 *
 * @param {http.IncomingMessage} req The request sent by the backend
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {undefined}
 */
function translateServiceResponse(req, res) {
  Object.keys
    .filter((k) => k.startsWith('Harmony'))
    .forEach((k) => copyHeader(req, res, k));
  const { query } = req;
  if (query.error) {
    res.status(400).send(query.error);
  } else if (query.redirect) {
    res.redirect(query.redirect);
  } else {
    copyHeader(req, res, 'Content-Type');
    copyHeader(req, res, 'Content-Length');
    req.pipe(res);
  }
}

/**
 * Express.js handler that calls backend services, registering a URL for the backend
 * to POST to when complete.  Responds to the client once the backend responds.
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<undefined>} Resolves when the request is complete
 */
function serviceInvoker(req, res) {
  return new Promise((resolve, reject) => {
    try {
      req.operation.callback = serviceResponse.bindResponseUrl((sreq, sres) => {
        translateServiceResponse(sreq, res);
        sres.status(200);
        sres.send('Ok');
        resolve();
      });
      invoke(req.operation);
    } catch (e) {
      serviceResponse.unbindResponseUrl(req.operation.callback);
      reject(e);
    }
  });
}

module.exports = serviceInvoker;
