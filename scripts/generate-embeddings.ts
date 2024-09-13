import * as fs from 'fs';
import * as path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import knexfile from '../db/knexfile';
import { knex, Knex } from 'knex';
import pgvector from 'pgvector/knex';

// Get the file path from the command line arguments
const args = process.argv.slice(2);
const filePath = args[0];

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


void (async (): Promise<void> => {

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    console.error('File does not exist:', filePath);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }

  try {
    const fileContents = fs.readFileSync(filePath, 'utf-8');
    const rows = JSON.parse(fileContents);
    const db = knex(knexfile);
    for (const row of rows) {
      const { collectionId, variableId, text } = row;
      console.log(`PROCESSION ${collectionId}: ${variableId}`);
      await db.transaction(async (tx) => {
        await storeEmbedding(tx, collectionId, variableId, text);
      });

    }

  } catch (error) {
    console.error('Failed to generate and store embedding:', error);
  }
})();
