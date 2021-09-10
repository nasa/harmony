import { stub, SinonStub } from 'sinon';
import { Logger } from 'winston';
import { Job } from '../../app/models/job';
import * as workflows from '../../app/util/workflows';

/**
 *  Stub calls to `terminateWorkflows`
 *
 * @param job - The Job whose workflow(s) should be canceled
 * @param logger - The Logger to use for log messages
 *
 * @returns The sinon stub that was created
 */
export function stubTerminateWorkflows(): SinonStub<[Job, Logger], Promise<void>> {
  return stub(workflows, 'terminateWorkflows');
}

/**
 * Hook to simulate an error terminating a workflow
 */
export function hookTerminateWorkflowError(): void {
  let terminateStub;
  before(async function () {
    terminateStub = stub(workflows, 'terminateWorkflows').throws();
  });
  after(async function () {
    if (terminateStub.restore) terminateStub.restore();
  });
}
