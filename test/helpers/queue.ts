import { stub, SinonStub } from 'sinon';
import * as qf from '../../app/util/queue/queue-factory';
import { MemoryQueue } from './memory-queue';


/**
 * This function sets up a memory queue and stubs the getQueue function for testing purposes.
 */
export function hookGetQueueForType(): void {
  before(function () {
    this.queue = new MemoryQueue();
    stub(qf, 'getQueueForType').callsFake(() => this.queue);
  });
  after(function () {
    (qf.getQueueForType as SinonStub).restore();
  });
}

/**
 * This function sets up a memory queue and stubs the getQueue function for testing purposes.
 * @param url - the URL of the queue to return
 * @returns a queue object based on the URL specified as the input parameter.
 */
export function hookGetQueueForUrl(): void {
  before(function () {
    this.serviceQueue = new MemoryQueue();
    stub(qf, 'getQueueForUrl').callsFake(() => this.serviceQueue);
  });
  after(function () {
    (qf.getQueueForUrl as SinonStub).restore();
  });
}

