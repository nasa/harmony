import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import WorkItem from '../../../../app/models/work-item';

/**
 * Hooks get work request. The mock axios object will respond an unlimitted number of times
 * with the desired response for the lifetime of the mock. The mock will also be added to
 * 'this.axiosMock' before the test runs, and deleted after it runs.
 * @param timeout - whether to mock a timeout
 * @param status - the http status code to return
 * @param workItem - the work item to return
 */
export function hookGetWorkRequest(
  response: { status: number; statusText?: string; workItem?: WorkItem },
  timeout = false,
): void {
  let mock;
  beforeEach(function () {
    mock = new MockAdapter(axios);
    if (timeout) {
      mock.onGet().timeout();
    } else if (response.workItem) {
      mock.onGet().reply(response.status, response.workItem);
    } else {
      mock.onGet().reply(response.status, response.statusText);
    }
    this.axiosMock = mock;
  });

  afterEach(function () {
    mock.restore();
    delete this.axiosMock;
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
