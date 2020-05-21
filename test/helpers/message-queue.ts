import { before, after } from 'mocha';
import sinon from 'sinon';
import aws from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import DeadLetterQueueMonitor from '../../app/workers/dead-letter-queue-monitor';


/**
 * Stub the given AWS method in before hooks, setting this[varname]
 * to the sinon mock
 * @param service - The name of the AWS service to stub, e.g. 'SQS'
 * @param method - The method on the service to mock, e.g. 'receiveMessage'
 * @param varname - The name of the var on 'this' to set with the stub value
 * @param response - The object to return when the AWS method is called
 */
function hookStubAws(service: string, method: string, varname: string, response): void {
  before(async function () {
    if (typeof response === 'function') {
      this[varname] = sinon.stub().callsFake(() => Promise.resolve(response.call(this)));
    } else {
      this[varname] = sinon.stub().resolves(response);
    }
    AWSMock.setSDKInstance(aws);
    AWSMock.mock(service, method, this[varname]);
  });

  after(function () {
    AWSMock.restore(service, method);
    delete this[varname];
  });
}

/**
 * Adds before/after hooks to stub sending to the message queue.  The stub is available as
 * this.sendStub for inspection.
 */
export function hookStubDelete(): void {
  hookStubAws('SQS', 'deleteMessage', 'deleteStub', null);
}

/**
 * Adds before/after hooks to stub sending to the message queue.  The stub is available as
 * this.sendStub for inspection.
 */
export function hookStubSend(): void {
  hookStubAws('SQS', 'sendMessage', 'sendStub', null);
}

/**
 * Adds before/after hooks to stub receiving from a message queue, producing the given response.
 * The stub is available as this.receiveStub for inspection.
 *
 * @param response - The response to return when receiveMessage is called
 */
export function hookStubReceive(response): void {
  hookStubAws('SQS', 'receiveMessage', 'receiveStub', response);
}

/**
 * Runs the dead letter queue monitor with queue name 'example-queue'
 *
 * @param receiveMessageTimeoutSeconds - Number of seconds to wait for a message before looping
 */
export function hookRunDeadLetterMonitor(receiveMessageTimeoutSeconds = 0): void {
  before(async function () {
    const monitor = new DeadLetterQueueMonitor('example-queue');
    monitor.start(receiveMessageTimeoutSeconds);
    await monitor.stop();
  });
}
