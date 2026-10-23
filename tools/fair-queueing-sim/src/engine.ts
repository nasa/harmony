import { InstalledClock } from '@sinonjs/fake-timers';

import { SIM_EPOCH_MS } from './bootstrap';

interface ScheduledEvent {
  time: number;
  seq: number;
  label: string;
  fn: () => Promise<void> | void;
  cancelled: boolean;
}

export interface EventHandle {
  cancel(): void;
}

/**
 * A discrete-event engine. Events run one at a time in time order (ties run in the order they
 * were scheduled), and each event runs to completion - including all of its database work -
 * before the virtual clock moves on. Harmony code therefore sees time stand still while it runs
 * and jump forward between events.
 */
export class Engine {
  private heap: ScheduledEvent[] = [];

  private seq = 0;

  private current = 0;

  private stopped = false;

  eventsRun = 0;

  /**
   * Creates an engine that drives the given clock.
   *
   * @param clock - the virtual clock installed in place of Date
   */
  constructor(private readonly clock: InstalledClock) {}

  /**
   * The current virtual time, in milliseconds since the start of the simulation.
   *
   * @returns the current virtual time
   */
  now(): number {
    return this.current;
  }

  /**
   * Schedules a function to run after the given delay.
   *
   * @param delayMs - delay in virtual milliseconds (negative delays are treated as 0)
   * @param label - a label for debugging
   * @param fn - the function to run
   * @returns a handle that can be used to cancel the event
   */
  schedule(delayMs: number, label: string, fn: () => Promise<void> | void): EventHandle {
    const event: ScheduledEvent = {
      time: this.current + Math.max(0, delayMs), seq: this.seq++, label, fn, cancelled: false,
    };
    this.push(event);
    return { cancel: (): void => { event.cancelled = true; } };
  }

  /**
   * Stops the simulation after the current event finishes.
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Runs events until there are none left, stop() is called, or the time limit is reached.
   *
   * @param untilMs - the virtual time at which to stop
   * @returns the virtual time when the simulation stopped
   */
  async run(untilMs: number): Promise<number> {
    while (!this.stopped && this.heap.length > 0) {
      const event = this.pop();
      if (event.cancelled) continue;
      if (event.time > untilMs) {
        this.current = untilMs;
        break;
      }
      this.current = event.time;
      this.clock.setSystemTime(SIM_EPOCH_MS + this.current);
      this.eventsRun += 1;
      await event.fn();
    }
    return this.current;
  }

  private less(a: ScheduledEvent, b: ScheduledEvent): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }

  private push(event: ScheduledEvent): void {
    const { heap } = this;
    heap.push(event);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  private pop(): ScheduledEvent {
    const { heap } = this;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && this.less(heap[l], heap[smallest])) smallest = l;
        if (r < heap.length && this.less(heap[r], heap[smallest])) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }
}
