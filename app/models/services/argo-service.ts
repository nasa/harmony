import _ from 'lodash';
import { Logger } from 'winston';
import * as axios from 'axios';
import BaseService, { functionalSerializeOperation } from './base-service';
import InvocationResult from './invocation-result';
import { batchOperations } from '../../util/batch';

import env = require('../../util/env');

export interface ArgoServiceParams {
  argo_url: string;
  namespace: string;
  template: string;
  template_type?: string;
  template_ref?: string;
  embedded_template?: string;
  image_pull_policy?: string;
  cmr_granule_locator_image_pull_policy?: string;
  parallelism?: number;
  postBatchStepCount?: number;
  env: { [key: string]: string };
  image?: string;
}

interface ArgoVariable {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: {
      name: string;
      key: string;
    };
  };
}

/**
 * Service implementation which invokes an Argo workflow and creates a Job to poll for service
 * updates.
 */
export default class ArgoService extends BaseService<ArgoServiceParams> {
  /**
   * Returns the batch size to use for the given request
   *
   * @param maxGranules - The system-wide maximum granules
   * @returns The number of granules per batch of results processed
   */
  chooseBatchSize(maxGranules = env.maxGranuleLimit): number {
    const maxResults = this.operation.maxResults || Number.MAX_SAFE_INTEGER;
    let batchSize = _.get(this.config, 'batch_size', env.defaultBatchSize);
    batchSize = batchSize <= 0 ? Number.MAX_SAFE_INTEGER : batchSize;

    return Math.min(maxGranules, batchSize, maxResults);
  }

  /**
   * Returns the page size to use for the given request
   *
   * @param maxGranules - The system-wide maximum granules
   * @returns The number of granules per page of results from the CMR
   */
  choosePageSize(maxGranules = env.maxGranuleLimit): number {
    const maxResults = this.operation.maxResults || Number.MAX_SAFE_INTEGER;

    return Math.min(maxResults, maxGranules, env.cmrMaxPageSize);
  }

  /**
   * Invokes an Argo workflow to execute a service request
   *
   *  @param logger - the logger associated with the request
   *  @returns A promise resolving to null
   */
  async _run(logger: Logger): Promise<InvocationResult> {
    if (this.operation.scrollIDs.length > 0) {
      // Do not send to Argo
      return null;
    }

    const url = `${this.params.argo_url}/api/v1/workflows/${this.params.namespace}`;

    const goodVars = _.reject(Object.keys(this.params.env),
      (variable) => _.includes(['OAUTH_UID', 'OAUTH_PASSWORD', 'EDL_USERNAME', 'EDL_PASSWORD'], variable));
    const dockerEnv = _.map(goodVars,
      (variable) => ({ name: variable, value: this.params.env[variable] }));

    // similarly we need to get at the model for the operation to retrieve parameters needed to
    // construct the workflow
    const serializedOperation = this.serializeOperation();
    const operation = JSON.parse(serializedOperation);

    let params = [
      {
        name: 'callback',
        value: operation.callback,
      },
      // Only needed for legacy workflow templates
      {
        name: 'image',
        value: this.params.image,
      },
      {
        name: 'image-pull-policy',
        value: this.params.image_pull_policy || env.defaultImagePullPolicy,
      },
      {
        name: 'cmr-granule-locator-image-pull-policy',
        value: env.cmrGranuleLocatorImagePullPolicy || env.defaultImagePullPolicy,
      },
      {
        name: 'timeout',
        value: `${env.defaultArgoPodTimeoutSecs}`, // Could use request specific value in the future
      },
      {
        name: 'post-batch-step-count',
        value: `${this.params.postBatchStepCount || 0}`,
      },
      {
        name: 'page-size',
        value: `${this.choosePageSize()}`,
      },
      {
        name: 'batch-size',
        value: `${this.chooseBatchSize()}`,
      },
      {
        name: 'parallelism',
        value: this.params.parallelism || env.defaultParallelism,
      },
      {
        name: 'query',
        value: this.operation.cmrQueryLocations.join(' '),
      },
    ];

    params = params.concat(dockerEnv);

    const templateType = this.params.template_type || 'legacy';
    const body = templateType === 'chaining' ? this._chainedWorkflowBody(params) : this._legacyWorkflowBody(params);
    const startTime = new Date().getTime();
    logger.info('timing.workflow-submission.start');
    try {
      await axios.default.post(url, body);
    } catch (e) {
      logger.error(`Argo workflow creation failed: ${JSON.stringify(e.response?.data)}`);
      logger.error(`Argo url: ${url}`);
      logger.error(`Workflow body: ${JSON.stringify(body)}`);
      throw e;
    }
    const endTime = new Date().getTime();
    const workflowSubmitTime = endTime - startTime;
    const frontendSubmitTime = endTime - this.operation.requestStartTime.getTime();
    logger.info('timing.workflow-submission.end', { durationMs: workflowSubmitTime });
    logger.info('timing.frontend-request.end', { durationMs: frontendSubmitTime });
    return null;
  }

  _buildExitHandlerScript(): string {
    return `
    echo '{{workflow.failures}}' > /tmp/failures
    error="{{workflow.status}}"
    timeout_count=$(grep -c 'Pod was active on the node longer than the specified deadline' /tmp/failures)
    if [ "$timeout_count" != "0" ]
    then
    error="Request%20timed%20out"
    fi
    if [ "{{workflow.status}}" == "Succeeded" ]
    then
    curl -XPOST "{{inputs.parameters.callback}}/response?status=successful&argo=true"
    else
    curl -XPOST "{{inputs.parameters.callback}}/response?status=failed&argo=true&error=$error"
    fi
    `.trim();
  }

  /**
   * Returns a workflow POST body for Argo for invoking chainable services
   * @param params - The common workflow parameters to be passed to each service
   * @returns a JSON-serializable object to be POST-ed to initiate the Argo workflows
   */
  _chainedWorkflowBody(params: ArgoVariable[]): unknown {
    const { user, requestId } = this.operation;

    // we need to serialize the batch operation to get just the model and then deserialize
    // it so we can pass it to the Argo looping/concurrency mechanism in the workflow
    // which expects objects not strings
    const serializedOp = functionalSerializeOperation(this.operation, this.config);

    const serializedOperation = JSON.parse(serializedOp);
    for (const source of serializedOperation.sources) {
      delete source.granules;
    }

    const argoParams = [...params, { name: 'operation', value: JSON.stringify(serializedOperation) }];
    return {
      namespace: this.params.namespace,
      serverDryRun: false,
      workflow: {
        metadata: {
          generateName: `${this.params.template}-chain-`,
          namespace: this.params.namespace,
          labels: {
            user,
            request_id: requestId,
          },
        },
        spec: {
          arguments: {
            parameters: argoParams,
          },
          parallelism: this.params.parallelism || env.defaultParallelism,
          workflowTemplateRef: {
            name: `${this.params.template}-chain`,
          },
        },
      },
    };
  }

  /**
   * Returns a workflow POST body for Argo for invoking legacy (non-chained, low-granule limit)
   * services
   * @param params - The common workflow parameters to be passed to each service
   * @returns a JSON-serializable object to be POST-ed to initiate the Argo workflows
   */
  _legacyWorkflowBody(params: ArgoVariable[]): unknown {
    const { user, requestId } = this.operation;
    // Further limit the batch size so the POST body doesn't exceed Argo limits
    const batchSize = this.chooseBatchSize(Math.min(env.maxGranuleLimit, 200));
    const parallelism = this.params.parallelism || env.defaultParallelism;

    const batch = batchOperations(this.operation, batchSize);
    // we need to serialize the batch operations to get just the models and then deserialize
    // them so we can pass them to the Argo looping/concurrency mechanism in the workflow
    // which expects objects not strings
    const ops = batch.map((op) => JSON.parse(functionalSerializeOperation(op, this.config)));

    return {
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
              parallelism,
              steps: [
                [
                  {
                    name: 'service',
                    templateRef: {
                      name: this.params.template,
                      template: this.params.template,
                    },
                    arguments: {
                      parameters: [
                        ...params,
                        { name: 'operation', value: '{{item}}' },
                        { name: 'batch-count', value: `${ops.length}` },
                      ],
                    },
                    withItems: ops,
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
                imagePullPolicy: 'IfNotPresent',
                command: ['sh'],
                source: this._buildExitHandlerScript(),
              },
            },
          ],
        },
      },
    };
  }
}
