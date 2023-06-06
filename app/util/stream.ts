import { Readable } from 'stream';

/**
 * Read a stream into a string
 *
 * @param readableStream - The stream to read
 * @returns A string containing the contents of the stream
 */
export async function streamToString(readableStream: Readable): Promise<string> {
  const chunks = [];

  for await (const chunk of readableStream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
}