import DataOperation from '../models/data-operation';
import HarmonyRequest from '../models/harmony-request';
import TurboService from '../models/services/turbo-service';
import NoOpService from '../models/services/no-op-service';
import HttpService from '../models/services/http-service';
import * as _ from 'lodash';
import { TransformableInfo } from 'logform';


/**
 * Redact sensitive values from an object if they exist.
 * 
 * @param obj - The object to inspect (for sensitive values like 'accessToken').
 * @param info - The parent object of 'obj'.
 * @param infoPath - The path (list of keys) within 'info' and 'infoClone' that leads to 'obj'.
 * @param infoClone - A clone of 'info' or undefined if no sensitive values have been found.
 * @returns - A clone of 'info' or undefined if no sensitive values have been found.
 */
function redactObject(  /* eslint-disable @typescript-eslint/no-explicit-any */
  obj: any, 
  info: TransformableInfo, 
  infoPath: string[], 
  infoClone: TransformableInfo | undefined): TransformableInfo {
  // obj may be an instance of a particular harmony class (e.g. DataOperation), or an
  // object that has similar data properties but is not a direct instantiation of that class
  if (obj?.accessToken) { // DataOperation model
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...infoPath, 'accessToken'], '<redacted>');
  }
  if ((obj as DataOperation)?.model?.accessToken) {
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...infoPath, 'model', 'accessToken'], '<redacted>');
  }
  if ((obj as TurboService | NoOpService | HttpService | HarmonyRequest)?.operation?.model?.accessToken) {
    infoClone = infoClone || _.cloneDeep(info);
    _.set(infoClone, [...infoPath, 'operation', 'model', 'accessToken'], '<redacted>');
  }
  return infoClone;
}

/**
 * Redact sensitive key values from an object. The object passed
 * to the function will be cloned if anything is redacted,
 * otherwise the original object is returned.
 * 
 * @param info - the TransformableInfo to inspect
 * @returns - TransformableInfo with sensitive values redacted
 */
export default function redact(
  info: TransformableInfo,
): TransformableInfo {
  let infoClone = redactObject(info, info, [], undefined);
  Object.keys(info).forEach(function (key) {
    if (typeof info[key] === 'object') {
      infoClone = redactObject(info[key], info, [key], infoClone);
    }
  });
  if (infoClone) {
    return infoClone;
  } else {
    return info;
  }
}