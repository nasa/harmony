import * as fs from 'fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import knexfile from '../db/knexfile';
import { knex, Knex } from 'knex';
import pgvector from 'pgvector/knex';
import PQueue from 'p-queue';
import logger from '../services/harmony/app/util/log';

const DB_BATCH_SIZE = 2000;
const MAX_CONCURRENT_BEDROCK_REQUESTS = 30;

const args = process.argv.slice(2);
const filePath = args[0];

const client = new BedrockRuntimeClient({ region: 'us-west-2' });

interface Embedding {
  collectionId: string;
  variableId: string;
  text: string;
}

/**
 * Fetches an embedding vector for a given input string using the Bedrock Titan embedding model.
 *
 * @param input - The text input for which to generate the embedding.
 * @returns A promise that resolves to the embedding vector (array of numbers).
 */
async function getEmbedding(input: string): Promise<number[]> {
  const response = await client.send(new InvokeModelCommand({
    body: JSON.stringify({ inputText: input }),
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
  }));
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.embedding;
}

/**
 * Stores a batch of embeddings into the database using a transaction.
 * Each text input is processed to generate an embedding, and the results
 * are stored in the 'umm_embeddings' table.
 *
 * @param tx - The transaction object for the database operations.
 * @param batch - An array of embedding data (collectionId, variableId, text).
 * @param queue - A promise queue to control concurrency when fetching embeddings from Bedrock.
 * @returns - A promise that resolves when the batch is successfully inserted into the database.
 */
async function storeEmbeddingsBatch(tx: Knex.Transaction, batch: Embedding[], queue: PQueue): Promise<void> {
  const items = await Promise.all(batch.map(async ({ collectionId, variableId, text }) => {
    const embedding = await queue.add(() => getEmbedding(text)); // Use PQueue to limit concurrency
    return {
      collection_id: collectionId,
      variable_id: variableId,
      embedding: pgvector.toSql(embedding),
    };
  }));

  // Insert the entire batch at once
  await tx('umm_embeddings').insert(items);
}

void (async (): Promise<void> => {
  if (!fs.existsSync(filePath)) {
    logger.error('File does not exist:', filePath);
    process.exit(1);
  }

  try {
    const fileContents = fs.readFileSync(filePath, 'utf-8');
    const rows = JSON.parse(fileContents);
    const db = knex(knexfile);

    const queue = new PQueue({ concurrency: MAX_CONCURRENT_BEDROCK_REQUESTS });

    const batches = [];
    for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
      batches.push(rows.slice(i, i + DB_BATCH_SIZE));
    }

    let n = 0;
    for (const batch of batches) {
      n = n + 1;
      logger.info(`Processing batch ${n} with ${batch.length} items`);
      await db.transaction(async (tx) => {
        await storeEmbeddingsBatch(tx, batch, queue);
      });
    }

    await queue.onIdle(); // Wait for all requests in the queue to finish processing

  } catch (error) {
    logger.error('Failed to generate and store embeddings:', error);
  }
})();

