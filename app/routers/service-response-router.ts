import express from 'express';
import { responseHandler } from 'backends/service-response';

/**
 * Creates and returns an express.Router instance that can receive callbacks from backend
 * services and route them to frontend requests that may be awaiting responses.
 *
 * @returns {express.Router} A router which can respond to backend services
 */
export default function router() {
  const result = express.Router();
  result.post('/:uuid/response', responseHandler);
  return result;
}
