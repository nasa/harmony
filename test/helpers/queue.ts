import { stub, SinonStub } from 'sinon';
import * as qf from '../../app/util/queue/queue-factory';
import { MemoryQueue } from './memory-queue';

let serviceQueues;


/**
 * This function sets up a memory queue and stubs the getQueueForType function for testing purposes.
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
 * This function sets up a memory queue and stubs the getQueueForUrl function for testing purposes.
 */
export function hookGetQueueForUrl(): void {
  before(function () {
    serviceQueues = {};
    stub(qf, 'getQueueForUrl').callsFake((url) => {
      if (!serviceQueues[url]) {
        serviceQueues[url] = new MemoryQueue();
      }
      return serviceQueues[url];
    });
  });
  after(function () {
    (qf.getQueueForUrl as SinonStub).restore();
    serviceQueues = {};
  });
}

/**
 * This function sets up a memory queue and stubs the getWorkSchedulerQueue function for testing
 * purposes.
 */
export function hookGetWorkSchedulerQueue(): void {
  before(function () {
    this.schedulerQueue = new MemoryQueue();
    stub(qf, 'getWorkSchedulerQueue').callsFake(() => this.schedulerQueue);
  });
  after(function () {
    (qf.getWorkSchedulerQueue as SinonStub).restore();
  });
}

/**
 * This function stubs the getQueueUrlForService function for testing purposes. It returns a fake
 * URL for the given service.
 */
export function hookGetQueueUrlForService(): void {
  before(function () {
    stub(qf, 'getQueueUrlForService').callsFake((service) => `${service}-url`);
  });
  after(function () {
    (qf.getQueueUrlForService as SinonStub).restore();
  });
}

/**
 * This function resets all the serviceQueues object.
 */
export function resetQueues(): void {
  serviceQueues = {};
}