const url = require('url');

function getRequestUrl(req) {
  return url.format({
    protocol: req.protocol,
    host: req.get('host'),
    pathname: req.originalUrl.split('?')[0],
  });
}

module.exports = {
  getRequestUrl,
};
