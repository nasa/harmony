import cancelAndSaveJob from 'util/job';
import { WorkflowListener, WorkflowEvent, WorkflowListenerConfig, EventType } from './workflow-listener';
import { getWorkflowByName } from '../util/workflows';

export default class WorkflowTerminationListener extends WorkflowListener {
  constructor(config: WorkflowListenerConfig) {
    const fullConfig = {
      ...config,
      ...{
        eventType: EventType.ADDED,
        reasonRegex: '(Workflow|WorkflowNode)Failed',
        messageRegex: '.*Terminate.*',
        namespace: 'argo',
      },
    };
    super(fullConfig);
  }

  async handleEvent(event: WorkflowEvent): Promise<void> {
    // retrieve the workflow using the name in the event
    const workflow = await getWorkflowByName(event.involvedObject.name, this.logger);
    const requestId = workflow.metadata.labels.request_id;
    this.logger.info(`Received termination request for job ${requestId}`);
    // cancel the job (without triggering an argo workflow termination)
    await cancelAndSaveJob(requestId, 'Canceled by admin', this.logger, true, null, true);
  }
}
