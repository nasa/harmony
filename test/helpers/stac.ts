import request from 'supertest';
import { before, after } from 'mocha';
import { auth } from './auth';

/**
 * Navigates to the STAC catalog route for the given job ID
 *
 * @param app - The express application (typically this.frontend)
 * @param jobId - The job ID
 * @returns An awaitable object that resolves to the request response
 */
export function stacCatalog(app: Express.Application, jobId: string): request.Test {
  return request(app).get(`/stac/${jobId}`);
}

/**
 * Navigates to the STAC item route for the given job ID and item index
 *
 * @param app - The express application (typically this.frontend)
 * @param jobId - The job ID
 * @param index - The index of the stac item in the stac catalog
 * @returns An awaitable object that resolves to the request response
 */
export function stacItem(app: Express.Application, jobId: string, index: number): request.Test {
  return request(app).get(`/stac/${jobId}/${index}`);
}

/**
 * Adds before/after hooks to navigate to the STAC catalog route
 *
 * @param jobId - The job ID
 * @param username - optional user to simulate logging in as
 */
export function hookStacCatalog(jobId: string, username: string = undefined): void {
  before(async function () {
    if (username) {
      this.res = await stacCatalog(this.frontend, jobId).use(auth({ username }));
    } else {
      this.res = await stacCatalog(this.frontend, jobId);
    }
  });
  after(function () {
    delete this.res;
  });
}

/**
* Adds before/after hooks to navigate to the STAC item route
*
* @param jobId - The job ID
* @param index - The item index
* @param username - optional user to simulate logging in as
*/
export function hookStacItem(jobId: string, index: number, username: string = undefined): void {
  before(async function () {
    if (username) {
      this.res = await stacItem(this.frontend, jobId, index).use(auth({ username }));
    } else {
      this.res = await stacItem(this.frontend, jobId, index);
    }
  });
  after(function () {
    delete this.res;
  });
}
