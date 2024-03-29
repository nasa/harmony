import { Transaction } from './../util/db';
import Record from './record';
import { truncateString } from '@harmony/util/string';

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

  // The error message of the deployment if applicable
  message: string;
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
 * Retruns deployment object
 */
export async function getDeploymentById(tx: Transaction, deploymentId: string): Promise<ServiceDeployment> {
  const result = await tx(ServiceDeployment.table)
    .select()
    .where({ deployment_id: deploymentId });
  return result[0];
}