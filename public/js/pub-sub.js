/**
 * Simple publish subscribe broker.
 */
export default class PubSub {
  
  /**
   * Instantiate a PubSub.
   */
  constructor() {
    this.handlers = [];
  }

  /**
   * Subscribe to an event with a handler.
   * @param {string} event - the id of the event
   * @param {function} handler - the handler function
   */
  subscribe(event, handler) {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(handler);
  }

  /**
   * Publish an event.
   * @param {string} event - the id of the event
   * @param {any} eventData - extra data to pass to the event handlers
   */
  publish(event, eventData) {
    const eventHandlers = this.handlers[event];
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        handler.call({}, eventData);
      }
    }
  }
}