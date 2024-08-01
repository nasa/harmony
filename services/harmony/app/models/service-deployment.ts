import { Transaction } from './../util/db';
import Record from './record';
import { truncateString } from '@harmony/util/string';

export enum ServiceDeploymentStatus {
  RUNNING = 'running',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
}

export type ServiceDeploymentForDisplay =
  Omit<ServiceDeployment, 'deployment_id' | 'id' | 'validate' | 'save' | 'serialize'> &
  { deploymentId: ServiceDeployment['deployment_id'] };

/**
 *
 * Wrapper object for service deployment
 *
 */
export default class ServiceDeployment extends Record {
  static table = 'service_deployments';

  // The ID of the deployment
  deployment_id: string;

  // The username associated with the deployment
  username: string;

  // The service name associated with the deployment
  service: string;

  // The service tag associated with the deployment
  tag: string;

  // The status of the deployment
  status: string;

  // The error message of the deployment if applicable
  message: string;

  serialize(): ServiceDeploymentForDisplay {
    const { deployment_id, username, service, tag, status, message, createdAt, updatedAt } = this;
    const serializedDeployment = {
      deploymentId: deployment_id,
      username,
      service,
      tag,
      status,
      message,
      createdAt,
      updatedAt,
    };
    return serializedDeployment;
  }
}

/**
 * Sets the status and message for the given deployment id.
 * @param tx - The database transaction
 * @param deploymentId - The deployment id
 * @param status - The deployment status
 * @param message - The deployment error message
 */
export async function setStatusMessage(tx: Transaction, deploymentId: string, status: string, message = ''): Promise<void> {
  if (message === '') {
    await tx(ServiceDeployment.table)
      .where({ deployment_id: deploymentId })
      .update('status', status);
  } else {
    await tx(ServiceDeployment.table)
      .where({ deployment_id: deploymentId })
      .update('status', status)
      .update('message', truncateString(message, 4096));
  }
}

/**
 * Gets deployment for the given deployment id.
 * @param tx - The database transaction
 * @param deploymentId - The deployment id
 * Returns deployment object
 */
export async function getDeploymentById(tx: Transaction, deploymentId: string): Promise<ServiceDeployment> {
  const result = await tx(ServiceDeployment.table)
    .select()
    .where({ deployment_id: deploymentId });
  if (result && result.length > 0) {
    return new ServiceDeployment(result[0]);
  }
  return undefined;
}

/**
 * Gets deployments with optional where clause filters.
 * @param tx - The database transaction
 * @param status - The ServiceDeploymentStatus enum (optional)
 * @param service - The service id (e.g. query-cmr, optional)
 * Returns deployment object
 */
export async function getDeployments(tx: Transaction, status?: ServiceDeploymentStatus, service?: string): Promise<ServiceDeployment[]> {
  const query = tx(ServiceDeployment.table)
    .select()
    .orderBy('createdAt', 'desc')
    .modify((queryBuilder) => {
      if (status) {
        void queryBuilder.where('status', status);
      }
      if (service) {
        void queryBuilder.where('service', service);
      }
    });

  const results = await query;
  return results.map((result: Record) => new ServiceDeployment(result));
}
