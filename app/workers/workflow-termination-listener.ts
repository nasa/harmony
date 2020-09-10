import cancelAndSaveJob from 'util/job';
import { WorkflowListener, WorkflowEvent, WorkflowListenerConfig, EventType } from './workflow-listener';
import { getWorkflowByName } from '../util/workflows';

export default class WorkflowTerminationListener extends WorkflowListener {
  constructor(config: WorkflowListenerConfig) {
    const fullConfig = {
      ...config,
      ...{
        eventType: EventType.ADDED,
        reasonRegex: 'WorkflowFailed',
        messageRegex: 'Stopped with strategy \'Terminate\'',
      },
    };
    super(fullConfig);
  }

  async eventCallback(event: WorkflowEvent): Promise<void> {
    // retrieve the workflow using the name in the event
    const workflow = await getWorkflowByName(event.involvedObject.name, this.logger);
    // call cancel on the Harmony services API
    const requestId = workflow.metadata.labels.request_id;

    await cancelAndSaveJob(requestId, 'Canceled by admin', this.logger, true);
  }
}
