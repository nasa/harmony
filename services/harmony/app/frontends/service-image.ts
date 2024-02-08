
import { Response, NextFunction } from 'express';
import HarmonyRequest from '../models/harmony-request';

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

export async function getServiceImages(
  _req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const imageMap = getImageMap();
  res.statusCode = 200;
  res.send(imageMap);
}

export async function getServiceImage(
  req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  const { service } = req.params;
  if (! await validateServiceExists(res, service)) return;

  const imageMap = getImageMap()
  const serviceImage = imageMap[service]
  res.statusCode = 200;
  res.send({'image': serviceImage});
}

export async function updateServiceImage(
  req: HarmonyRequest, res: Response, _next: NextFunction,
) {
  const { service } = req.params;
  if(! await validateServiceExists(res, service)) return;

  if (!req.body) {
    res.statusCode = 400;
    res.send('\'image\' and \'tag\' are required body parameters');
    return;
  }
  const imageMap = getImageMap()
  const { image, tag } = req.body;
  imageMap[service] = `${image}:${tag}`;
  res.statusCode = 201;
}
