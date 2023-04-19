import { stub, SinonStub } from 'sinon';
import * as qf from '../../app/util/queue/queue-factory';
import { MemoryQueue } from './memory-queue';


/**
 * This function sets up a memory queue and stubs the getQueue function for testing purposes.
 */
export function hookGetQueue(): void {
  before(function () {
    this.queue = new MemoryQueue();
    stub(qf, 'getQueue').callsFake(() => this.queue);
  });
  after(function () {
    (qf.getQueue as SinonStub).restore();
  });
}