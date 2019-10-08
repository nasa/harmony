process.env.VCR_MODE = process.env.VCR_MODE || 'cache';

const replayer = require('replayer');

replayer.configure({
  includeHeaderNames: false,
  includeCookieNames: false,
});

replayer.filter({
  url: /(127.0.0.1|localhost)/,
  forceLive: true,
});
