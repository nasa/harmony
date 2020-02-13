/**
 * Abstract base class for message queues. Provides a basic interface allowing
 * for different underlying message queue implementations.
 *
 * @class BaseQueue
 * @abstract
 */
class BaseQueue {
  /**
   * Creates an instance of a BaseQueue.
   * @param {Object} config The queue configuration
   * @param {Logger} logger The logger associated with this request
   * @memberof BaseQueue
   */
  constructor(config, logger) {
    if (new.target === BaseQueue) {
      throw new TypeError('BaseService is abstract and cannot be instantiated directly');
    }
    this.config = config;
    this.logger = logger;
  }

  /**
   * Create a new queue
   * @param {String} _qname The name of the queue
   * @param {Integer} _vt Visibility timeout for all messages put on the queue
   * @memberof BaseQueue
   * @returns {void}
   */
  createQueue({ _qname, _vt = 3600 }) {
    throw new TypeError('BaseQueue subclasses must implement #createQueue()');
  }

  /**
   * Publish a message on a queue.
   * @param {String} _qname The name of the queue
   * @param {Object} _message The message to publish on the queue
   * @memberof BaseQueue
   * @returns {void}
   */
  sendMessage({ _qname, _message }) {
    throw new TypeError('BaseQueue subclasses must implement #sendMessage()');
  }

  /**
   * Gets a message from a queue.
   * @param {String} _qname The name of the queue
   * @param {Integer} _vt A message specific visibility time overriding queue policy
   * @memberof BaseQueue
   * @returns {Object} The message contents and the number of times this message has been tried
   */
  receiveMessage({ _qname, _vt }) {
    throw new TypeError('BaseQueue subclasses must implement #receiveMessage()');
  }

  /**
   * Deletes a message from a queue.
   * @param {String} _qname The name of the queue
   * @param {Object} _id The message ID to delete from the queue
   * @memberof BaseQueue
   * @returns {void}
   */
  deleteMessage({ _qname, _id }) {
    throw new TypeError('BaseQueue subclasses must implement #deleteMessage()');
  }

  /**
   * Change the visibility timer of a single message. The time when the message will be visible
   * again is calculated from the current time (now) + vt
   * Use this for retrying a message.
   *
   * @param {String} _qname The name of the queue
   * @param {Object} _id The message ID
   * @param {Number} _vt Seconds until the message will be visible again.
   * @memberof BaseQueue
   * @returns {void}
   */
  changeMessageVisibility({ _qname, _id, _vt }) {
    throw new TypeError('BaseQueue subclasses must implement #changeMessageVisibility()');
  }
}

module.exports = BaseQueue;
