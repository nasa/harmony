export default interface Worker {
  /**
   * start the worker running continuously
   * @param config the optional configuration to use
   */
  start(): Promise<void>;

  /**
   * Stop the worker
   */
  stop?(): Promise<void>;
}
