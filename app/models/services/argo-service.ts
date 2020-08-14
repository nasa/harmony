import { Logger } from 'winston';
import * as axios from 'axios';
import BaseService from './base-service';
import InvocationResult from './invocation-result';
import env from '../../util/env';

export interface ArgoServiceParams {
  argo_url: string;
  namespace: string;
  template: string;
  image: string;
  env: { [key: string]: string };
}

/**
 * Service implementation which invokes an Argo workflow and creates a Job to poll for service
 * updates.
 * @class ArgoService
 * @extends {BaseService}
 */
export default class ArgoService extends BaseService<ArgoServiceParams> {
  /**
   * Invokes an Argo workflow to execute a service request
   *
   *  @param _logger the logger associated with the request
   *  @returns A promise resolving to null
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    const url = `${this.params.argo_url}/api/v1/workflows/${this.params.namespace}`;
    const { user, requestId } = this.operation;
    const input = this.serializeOperation();

    const dockerEnv = [];
    for (const variable of Object.keys(this.params.env)) {
      dockerEnv.push({ name: variable, value: this.params.env[variable] });
    }

    let params = [
      {
        name: 'operation',
        value: input,
      },
      {
        name: 'image',
        value: this.params.image,
      },
      {
        name: 'image-pull-policy',
        value: env.imagePullPolicy,
      },
    ];

    params = params.concat(dockerEnv);

    const body = {
      namespace: this.params.namespace,
      serverDryRun: false,
      workflow: {
        metadata: {
          generateName: `${this.params.template}-`,
          namespace: this.params.namespace,
          labels: {
            user,
            request_id: requestId,
          },
        },
        spec: {
          workflowTemplateRef: {
            name: this.params.template,
          },
          env: dockerEnv,
          arguments: {
            parameters: params,
          },
        },
      },
    };

    await axios.default.post(url, body);

    return null;
  }
}
