import { expect } from 'chai';
import * as sinon from 'sinon';

// Import the function to test (adjust import path as needed)
// Assuming the sleepCheck function is in a file called sleepUtils.ts
import { sleepCheck } from '../app/util/sleep-check';

describe('sleepCheck', () => {
  // Use fake timers to control time in tests
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    // Setup fake timer before each test
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    // Restore real timers after each test
    clock.restore();
  });

  it('should resolve immediately if check function returns true initially', async () => {
    const checkStub = sinon.stub().returns(true);

    await sleepCheck(5000, checkStub);

    // Advance time by a small amount to allow any pending promises to resolve
    await clock.tickAsync(10);

    // Check function should have been called once
    expect(checkStub.calledOnce).to.be.true;
  });

  it('should wait for check function to return true', async () => {
    // Create a stub that returns false twice, then true
    const checkStub = sinon.stub();
    checkStub.onCall(0).returns(false);
    checkStub.onCall(1).returns(false);
    checkStub.onCall(2).returns(true);

    const promise = sleepCheck(5000, checkStub);

    // Advance time by 1/2 second
    await clock.tickAsync(500);
    expect(checkStub.calledOnce).to.be.true;

    // Advance time by another 1/2 second
    await clock.tickAsync(500);
    expect(checkStub.calledTwice).to.be.true;

    // Advance time by another second, which should trigger the third call
    // and resolve the promise
    await clock.tickAsync(1000);
    expect(checkStub.calledThrice).to.be.true;

    // Wait for the promise to resolve
    await promise;
  });

  it('should timeout after specified duration if check never passes', async () => {
    const checkStub = sinon.stub().returns(false);

    const promise = sleepCheck(3500, checkStub);

    // Advance clock by slightly more than the total duration
    await clock.tickAsync(3600);

    // Check that the function was called 4 times (at ~1s, ~2s, ~3s, and at the end)
    expect(checkStub.callCount).to.equal(4);

    // Wait for the promise to resolve
    await promise;
  });

  it('should handle durations less than 1 second', async () => {
    const checkStub = sinon.stub().returns(false);

    const promise = sleepCheck(500, checkStub);

    // Advance time just beyond the duration
    await clock.tickAsync(510);

    // Check that the function was called just once at the end
    expect(checkStub.calledOnce).to.be.true;

    // Wait for the promise to resolve
    await promise;
  });

  it('should handle zero duration', async () => {
    const checkStub = sinon.stub().returns(false);

    const promise = sleepCheck(0, checkStub);

    // Advance a tiny bit of time to allow promises to resolve
    await clock.tickAsync(10);

    // Check function should not be called
    expect(checkStub.called).to.be.false;

    // Wait for the promise to resolve
    await promise;
  });
});