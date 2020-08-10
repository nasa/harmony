import { Logger } from 'winston';
import * as axios from 'axios';
import BaseService from './base-service';
import InvocationResult from './invocation-result';

export interface ArgoServiceParams {
  argo_url: string;
  namespace: string;
  template: string;
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
   * @returns A promise resolving to null
   */
  async _run(_logger: Logger): Promise<InvocationResult> {
    const url = `${this.params.argo_url}/api/v1/workflows/${this.params.namespace}`;
    const { user, requestId } = this.operation;
    const input = this.serializeOperation();

    // const body1 = {
    //   namespace: this.params.namespace,
    //   resourceKind: 'string',
    //   resourceName: 'string',
    //   submitOptions: {
    //     dryRun: false,
    //     entryPoint: 'string',
    //     generateName: 'string',
    //     labels: 'string',
    //     name: 'string',
    //     ownerReference: {
    //       apiVersion: 'string',
    //       blockOwnerDeletion: true,
    //       controller: true,
    //       kind: 'string',
    //       name: 'string',
    //       uid: 'string',
    //     },
    //     parameterFile: 'string',
    //     parameters: [
    //       input,
    //     ],
    //     serverDryRun: false,
    //     serviceAccount: 'string',
    //   },
    // };

    const body = {
      namespace: this.params.namespace,
      serverDryRun: false,
      workflow: {
        metadata: {
          generateName: 'hello-world-input',
          namespace: 'argo',
          labels: {
            user,
            request_id: requestId,
          },
        },
        spec: {
          templates: [
            {
              name: 'whalesay',
              arguments: {},
              inputs: {
                parameters: [
                  {
                    name: 'message',
                  },
                ],
              },
              outputs: {},
              metadata: {},
              container: {
                name: '',
                image: 'docker/whalesay:latest',
                command: [
                  'cowsay',
                ],
                args: [
                  '{{inputs.parameters.message}}',
                ],
                resources: {},
              },
            },
          ],
          entrypoint: 'whalesay',
          arguments: {
            parameters: [
              {
                name: 'message',
                value: input,
              },
            ],
          },
        },
      },
    };

    try {
      const resp = await axios.default.post(url, body);
      console.log(resp);
    } catch (error) {
      console.log(error);
    }

    return null;
  }
}
