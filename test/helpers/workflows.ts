import { stub, SinonStub } from 'sinon';
import { Job } from 'models/job';
import { Logger } from 'winston';
import * as workflow from '../../app/util/workflows';

/**
 *  Stub calls to `terminateWorkflows`
 *
 * @param job - The Job whose workflow(s) should be canceled
 * @param logger - The Logger to use for log messages
 *
 * @returns The sinon stub that was created
 */
export function stubTerminateWorkflows(): SinonStub<[Job, Logger], Promise<void>> {
  return stub(workflow, 'terminateWorkflows');
}

/**
 * Hook to simulate an error terminating a workflow
 */
export function hookTerminateWorkflowError(): void {
  let terminateStub;
  before(async function () {
    terminateStub = stub(workflow, 'terminateWorkflows').throws();
  });
  after(async function () {
    if (terminateStub.restore) terminateStub.restore();
  });
}
