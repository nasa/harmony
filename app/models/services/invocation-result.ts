/**
 * Result of a service invocation
 */
export default interface InvocationResult {
  /**
   * An error message.  If set, the invocation was an error and the provided message
   * should be sent to the client
   */
  error?: string;

  /**
   * An HTTP status code for the response.  If set and there is an error, the HTTP status
   * code will be set to this value
   */
  statusCode?: number;

  /**
   * A redirect URL.  If set, the client should be redirected to this URL
   */
  redirect?: string;

  /**
   * A readable stream.  If set, the bytes in the stream should be piped to the client
   */
  stream?: ReadableStream;

  /**
   * An object mapping key/value headers.  Any headers starting with "harmony" should
   * be passed to the client.  When streaming a result, content-type and content-length
   * should also be set.
   */
  headers?: object;

  /**
   * String literal content to send back to the caller
   */
  content?: string;

  /**
   * A callback function with no arguments to be invoked when the client receives its response
   */
  onComplete?: (err?: Error) => void;
}
