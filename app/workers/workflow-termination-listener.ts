import { WorkflowListener, WorkflowEvent, WorkflowListenerConfig, EventType } from './workflow-listener';

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
    // call cancel on the Harmony services API
  }
}
