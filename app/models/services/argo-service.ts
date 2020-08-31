import { Logger } from 'winston';
import * as axios from 'axios';
import BaseService from './base-service';
import InvocationResult from './invocation-result';
import env = require('../../util/env');

export interface ArgoServiceParams {
  argo_url: string;
  namespace: string;
  template: string;
  image: string;
  imagePullPolicy?: string;
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
  async _run(logger: Logger): Promise<InvocationResult> {
    const url = `${this.params.argo_url}/api/v1/workflows/${this.params.namespace}`;
    const { user, requestId } = this.operation;
    const input = this.serializeOperation();

    const dockerEnv = [];
    for (const variable of Object.keys(this.params.env)) {
      // do not send EDL credentials
      if (variable !== 'EDL_USERNAME' && variable !== 'EDL_PASSWORD') {
        dockerEnv.push({ name: variable, value: this.params.env[variable] });
      }
    }

    const operation = JSON.parse(input);

    const exitHandlerScript = `
    if [ "{{workflow.status}}" == "Succeeded" ]
    then
    curl -XPOST "{{inputs.parameters.callback}}/response?status=successful&argo=true"
    else
    curl -XPOST "{{inputs.parameters.callback}}/response?status=failed&argo=true&error={{workflow.status}}"
    fi
    `.trim();

    let params = [
      {
        name: 'operation',
        value: input,
      },
      {
        name: 'callback',
        value: operation.callback,
      },
      {
        name: 'image',
        value: this.params.image,
      },
      {
        name: 'image-pull-policy',
        value: this.params.imagePullPolicy || env.defaultImagePullPolicy,
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
          entryPoint: 'service',
          onExit: 'exit-handler',
          templates: [
            {
              name: 'service',
              steps: [
                [
                  {
                    name: 'service',
                    templateRef: {
                      name: this.params.template,
                      template: this.params.template,
                    },
                    arguments: {
                      parameters: params,
                    },
                  },
                ],
              ],
            },
            {
              name: 'exit-handler',
              inputs: {
                parameters: params,
              },
              script: {
                image: 'curlimages/curl',
                command: ['sh'],
                source: exitHandlerScript,
              },
            },
          ],
        },
      },
    };

    try {
      await axios.default.post(url, body);
    } catch (e) {
      logger.error(`Argo workflow creation failed: ${JSON.stringify(e.response?.data)}`);
      logger.error(`Argo url: ${url}`);
      logger.error(`Workflow body: ${JSON.stringify(body)}`);
      throw e;
    }

    return null;
  }
}
