import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import WorkItem from '../../../../app/models/work-item';

/**
 * Hooks get work request
 * @param status - the http status code to return
 * @param workItem - the work item to return
 */
export function hookGetWorkRequest(
  response: { status: number; statusText?: string; workItem?: WorkItem },
): void {
  let mock;
  beforeEach(function () {
    mock = new MockAdapter(axios);
    if (response.workItem) {
      mock.onGet().replyOnce(response.status, response.workItem);
    } else {
      mock.onGet().replyOnce(response.status, response.statusText);
    }
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
export function hookWorkItemUpdate(status: number, message?: string): MockAdapter {
  const mock = new MockAdapter(axios);
  beforeEach(function () {
    mock.onPut().reply(status, message);
  });

  afterEach(function () {
    mock.restore();
  });

  return mock;
}
