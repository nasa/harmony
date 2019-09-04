const process = require('process');
const { spawn } = require('child_process');
const serviceResponse = require('./service-response');
const { log } = require('../util/log');

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

function invoke(operation) {
  // Cheat for now, because gdal is the only valid backend.  We will have to add more
  // and then add service selection in the future
  invokeLocalDockerService('harmony/gdal', operation);
}

function copyHeader(req, res, header) {
  return res.set(header, req.get(header));
}

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

function serviceInvoker(req, res) {
  return new Promise((resolve, reject) => {
    try {
      req.operation.callback = serviceResponse.bindResponseUrl((sreq, sres) => {
        resolve(translateServiceResponse(sreq, res));
        sres.status(200);
        sres.send('Ok');
      });
      invoke(req.operation);
    } catch (e) {
      serviceResponse.unbindResponseUrl(req.operation.callback);
      reject(e);
    }
  });
}

module.exports = serviceInvoker;
