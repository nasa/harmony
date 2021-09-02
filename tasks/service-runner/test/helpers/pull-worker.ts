import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import WorkItem from '../../../../app/models/work-item';

/**
 * Hooks get work request
 * @param status - the http status code to return
 * @param workItem - the work item to return
 */
export function hookGetWorkRequest(status: number, workItem: WorkItem): void {
  let mock;
  beforeEach(function () {
    mock = new MockAdapter(axios);
    mock.onGet().reply(status, workItem);
  });

  afterEach(function () {
    mock.restore();
  });
}
/**
 * Hooks work item update
 * @param status - the http status code to return
 * @param message - the message to return
 */
export function hookWorkItemUpdate(status: number, message?: string): void {
  const mock = new MockAdapter(axios);
  beforeEach(function () {
    mock.onPut().reply(status, message);
  });

  afterEach(function () {
    mock.restore();
  });
}
