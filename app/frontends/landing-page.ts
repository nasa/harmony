import { Response } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getRequestRoot } from '../util/url';
import { getCloudAccessJsonLink, getCloudAccessShLink } from '../util/links';
import env from '../util/env';

/**
 * Express.js handler that returns the main Harmony landing page content.
 *
 * Includes minimal JSON with a list of all of the Harmony routes. Flush this out as an
 * OpenAPI document at some point.
 * @param req The request sent by the client
 * @param res The response to send to the client
 * @returns {void}
 */
export default function landingPage(req: HarmonyRequest, res: Response): void {
  const root = getRequestRoot(req);
  const cloudAccessJsonLink = getCloudAccessJsonLink(root);
  const cloudAccessShLink = getCloudAccessShLink(root);
  const description = 'Harmony allows users to submit requests to perform transformations '
    + 'on EOSDIS data. Transformations can be performed using one of several Open Geospatial '
    + 'Consortium (OGC) inspired APIs. Each API requires a collection concept ID from '
    + `${env.cmrEndpoint}, and then transformations can be `
    + `performed using ${root}/{collectionId}/ogc-api-coverages/1.0.0 or `
    + `${root}/{collectionId}/wms. 'All users will need an Earthdata login account from `
    + `${env.oauthHost} in order to perform transformations. See the links `
    + 'field for additional Harmony routes.';

  const links = [
    {
      title: 'Harmony landing page',
      href: `${root}`,
      rel: 'self',
      type: 'application/json',
    },
    {
      title: 'Jobs listing returning all jobs for the logged in user',
      href: `${root}/jobs`,
      rel: 'jobs',
      type: 'application/json',
    },
    cloudAccessJsonLink,
    cloudAccessShLink,
  ];
  res.json({ description, links });
}
