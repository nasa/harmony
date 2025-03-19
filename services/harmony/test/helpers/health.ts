import sinon from 'sinon';
import request from 'supertest';
import { hookRequest } from './hooks';
import * as cmr from '../../app/util/cmr';
import * as edl from '../../app/util/edl-api';

/**
 * Hooks to stub CMR and EDL health checks for specific tests.
 */
export function hookCmrEdlHealthCheck(
  cmrStatus: { healthy: boolean, message: string },
  edlStatus: boolean): void {
  let cmrStub;
  let edlStub;

  before(function () {
    cmrStub = sinon.stub(cmr, 'isCmrHealthy').callsFake(async () => cmrStatus);
    edlStub = sinon.stub(edl, 'isEdlHealthy').callsFake(async () => edlStatus);
  });

  after(function () {
    cmrStub.restore();
    edlStub.restore();
  });
}

/**
 * Makes a /admin/health request
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function getAdminHealth(app): request.Test {
  return request(app).get('/admin/health');
}

/**
 * Makes a /health request
 * @param app - The express application (typically this.frontend)
 * @returns The response
 */
export function getHealth(app): request.Test {
  return request(app).get('/health');
}

export const hookGetAdminHealth = hookRequest.bind(this, getAdminHealth);
export const hookGetHealth = hookRequest.bind(this, getHealth);

