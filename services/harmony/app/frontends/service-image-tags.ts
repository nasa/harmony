
import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';
import { getEdlGroupInformation, isAdminUser } from '../util/edl-api';

const harmonyTaskServices = [
  'work-item-scheduler',
  'work-item-updater',
  'work-reaper',
  'work-failer',
];

// NOTE this should only be accessed through `getImageMap`
let _imageMap = null;

/**
 * Compute and cache the map of services to images/tags. Harmony
 * core services are excluded.
 * @returns The map of canonical service names to images/tags.
 */
function getImageMap() {
  if (!_imageMap) {
    _imageMap = {};
    for (const v of Object.keys(process.env)) {
      if(v.endsWith('_IMAGE')) {
        const serviceName = v.slice(0, -6).toLowerCase().replaceAll('_', '-');
        // add in any services that are not Harmony core task services
        if (!harmonyTaskServices.includes(serviceName)) {
          const image = process.env[v];
          _imageMap[serviceName] = image;
        }
      }
    }
  }

  return _imageMap;
}

async function validateServiceExists(
  res: Response, service: string,
): Promise<boolean> {
  const imageMap = getImageMap();
  if (!imageMap[service]) {
    res.statusCode = 404;
    const message = `Service ${service} does not exist.\nThe existing services and their images are\n${JSON.stringify(imageMap, null, 2)}`;
    res.send(message);
    return false;
  }
  return true;
}

async function validateUserIsInDeployerGroup(
  req: HarmonyRequest, res: Response
): Promise<boolean> {
  const { isServiceDeployer } = await getEdlGroupInformation(
    req.user, req.context.logger,
  );

  if (!isServiceDeployer) {
    res.statusCode = 403;
    res.send(`User ${req.user} is not in the service deployers EDL group`);
    return false;
  }
  return true;
}

async function validateTag(
  req: HarmonyRequest, res: Response
): Promise<boolean> {
  const { tag } = req.body;
  const tagRegex = /^[a-zA-Z\d_][a-zA-Z\d\-_.]{0,127}$/;
  if (!tagRegex.test(tag)) {
    res.statusCode = 400;
    res.send('A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.');
    return false;
  }
  return true;
}

export async function getServiceImageTags(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if(! await validateUserIsInDeployerGroup(req, res)) return;

  const imageMap = getImageMap();
  res.statusCode = 200;
  res.send(imageMap);
}

export async function getServiceImageTag(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if(! await validateUserIsInDeployerGroup(req, res)) return;
  const { service } = req.params;
  if (! await validateServiceExists(res, service)) return;

  const imageMap = getImageMap()
  const serviceImage = imageMap[service]
  const tag = serviceImage.match(/.*:(.*)/)[1] || '';
  res.statusCode = 200;
  res.send({'tag': tag});
}

export async function updateServiceImageTag(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  if(! await validateUserIsInDeployerGroup(req, res)) return;

  const { service } = req.params;
  if(! await validateServiceExists(res, service)) return;
  if (!req.body || !req.body.tag) {
    res.statusCode = 400;
    res.send('\'tag\' is a required body parameter');
    return;
  }

  if (! await validateTag(req, res)) return;

  const { tag } = req.body;
  const imageMap = getImageMap()
  let imageUrl = imageMap[service]
  const imageBase = imageUrl.match(/(.*):.*/)[1];

  imageMap[service] = `${imageBase}:${tag}`;
  res.statusCode = 201;
  res.send({'tag': tag});
}
