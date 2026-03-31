import { NextFunction, RequestHandler, Response } from 'express';

import HarmonyRequest from '../models/harmony-request';

/**
 * Express.js middleware that handles preflight CORS options requests
 *
 * @param req - The client request
 * @param res - The client response
 * @param next - The next function in the middleware chain
 */
const optionsHandler: RequestHandler = (req: HarmonyRequest, res: Response, _next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', [
    'Authorization',
    'Content-Type',
    'Content-Length',
    'Accept',
  ].join(', '));
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Encoding',
    'Content-Disposition',
  ].join(', '));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
};

export default optionsHandler;
