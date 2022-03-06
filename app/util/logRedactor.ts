import DataOperation from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';
import TurboService from '../models/services/turbo-service';
import NoOpService from '../models/services/no-op-service';
import HttpService from '../models/services/http-service';
import * as _ from 'lodash';


/**
 * Redact sensitive values from an object if they exist.
 */
function redactObject(obj, objPath, info, infoClone): object {
  // obj may be an instance of a particular harmony class (e.g. DataOperation), or an
  // object that has similar data properties but is not a direct instantiation of that class
  if (obj?.accessToken) { // DataOperation model
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...objPath, 'accessToken'], '<redacted>');
  }
  if ((obj as DataOperation)?.model?.accessToken) {
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...objPath, 'model', 'accessToken'], '<redacted>');
  }
  if ((obj as TurboService | NoOpService | HttpService | HarmonyRequest)?.operation?.model?.accessToken) {
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...objPath, 'operation', 'model', 'accessToken'], '<redacted>');
  }
  return infoClone;
}

/**
 * Redact sensitive key values from an object. The object passed
 * to the function will be cloned if anything is redacted,
 * otherwise the original object is returned.
 * 
 * @param info - the object to inspect 
 */
export default function redact( /* eslint-disable @typescript-eslint/no-explicit-any */
  info: object,
): any {
  let infoClone = redactObject(info, [], info, null);
  Object.keys(info).forEach(function (key) {
    if (typeof info[key] === 'object') {
      infoClone = redactObject(info[key], [key], info, infoClone);
    }
  });
  if (infoClone) {
    return infoClone;
  } else {
    return info;
  }
}