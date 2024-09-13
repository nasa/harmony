import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import knexfile from '../db/knexfile';
import { knex, Knex } from 'knex';
import pgvector from 'pgvector/knex';
// import db, { Transaction } from '../services/harmony/app/util/db';

const client = new BedrockRuntimeClient({ region: 'us-west-2' });


/**
 *  Get an embedding for a given string
 *
 * @param input - the string to get the embedding for
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
 * Get an embedding vector for the given text and store it along with
 * the concept_ids for the collection/variable in the database
 *
 * @param tx - The database transaction
 * @param collection_id - the CMR collection concept id
 * @param variable_id - the CMR variable concept id
 * @param text - the combined text of the collection and variable descriptions
 */
async function storeEmbedding(tx: Knex.Transaction, collection_id: string, variable_id: string, text: string): Promise<void> {
  const embedding = await getEmbedding(text);
  const item = {
    collection_id,
    variable_id,
    embedding: pgvector.toSql(embedding),
  };
  await tx('umm_embeddings').insert([item]);
}

// Example usage
void (async (): Promise<void> => {
  const text = 'Hello, world';

  try {
    const db = knex(knexfile);
    const embedding = await getEmbedding(text);
    console.log('Embedding:', JSON.stringify(embedding));
    console.log(`LENGTH: ${embedding.length}`);
    await db.transaction(async (tx) => {
      await storeEmbedding(tx, 'C-1234TEST', 'V-1234TEST', text);
    });

  } catch (error) {
    console.error('Failed to generate or store embedding:', error);
  }
})();
