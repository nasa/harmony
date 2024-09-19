/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response, NextFunction } from 'express';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import fetch from 'node-fetch';
import { buffer, Units } from '@turf/turf';
import HarmonyRequest from '../models/harmony-request';
import { parseNumber } from '../util/parameter-parsing-helpers';
import knexfile from '../../../../db/knexfile';
import { knex } from 'knex';

/**
 * get GeoJSON for a given place
 *
 * @param placeName - the place/region by name
 * @returns
 */
export async function getGeoJsonByPlaceName(placeName: string): Promise<any> {
  // Nominatim API endpoint to search for a place by name and return GeoJSON format
  const url = `https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&q=${encodeURIComponent(placeName)}`;
  console.log(`OPEN STREET MAPS URL: ${url}`);

  try {
    // Fetch the GeoJSON data
    const response = await fetch(url, { headers: { 'User-agent': 'harmony' } });

    if (!response.ok) {
      throw new Error(`Error fetching data for ${placeName}: ${response.statusText}`);
    }

    // Parse the JSON response
    const geoJson = await response.json();

    // Return the GeoJSON
    return geoJson;
  } catch (error) {
    console.error(`Error fetching GeoJSON: ${error.message}`);
    throw error;
  }
}

interface ModelOutput {
  propertyOfInterest: string;
  placeOfInterest: string | null;
  bufferNumber: number | null;
  bufferUnits: string | null;
  timeInterval: string | null;
  outputFormat: string | null;
}

interface GeneratedHarmonyRequestParameters {
  collection: string;
  variable: string;
  timeInterval
  outputFormat: string | null;
}

const distanceUnits = {
  'mi': 'miles',
  'mile': 'miles',
  'miles': 'miles',
  'km': 'kilometers',
  'kilometer': 'kilometers',
  'kilometers': 'kilometers',
};

/**
 * Parse the output of an LLM to get information needed to make a Harmony query
 * TODO make this more robust
 *
 * @param rawOutput - the output from the LLM
 */
function parseModelOutput(rawOutput: string): ModelOutput {
  const rawOutputLines = rawOutput.split('\n');
  rawOutputLines.splice(0, 2);
  rawOutputLines.splice(rawOutputLines.length - 1, 1);
  console.log(`LINES: ${JSON.stringify(rawOutputLines, null, 2)}`);
  const rawOutputJson = JSON.parse(rawOutputLines.join('\n')).rows[0];
  const placeOfInterest = rawOutputJson['Place of interest'] === 'N/A' ? null : rawOutputJson['Place of interest'];
  const bufferStr: string = rawOutputJson['Buffer radius'];
  let bufferNumber;
  let bufferUnits;
  if (bufferStr != 'N/A') {
    bufferNumber = parseNumber(bufferStr.split(' ')[0]);
    bufferUnits = distanceUnits[bufferStr.split(' ')[1]];
  }
  const timeInterval = rawOutputJson['Time interval'] === 'N/A' ? null : rawOutputJson['Time interval'];
  const outputFormat = rawOutputJson['File format'] == 'N/A' ? null : rawOutputJson['File format'];

  return {
    propertyOfInterest: rawOutputJson['Measured property of interest'],
    placeOfInterest,
    bufferNumber,
    bufferUnits,
    timeInterval,
    outputFormat,
  };
}

/**
 *  Get an embedding for a given string
 *
 * @param input - the string to get the embedding for
 */
async function getEmbedding(input: string): Promise<number[]> {
  const embeddingModelId = 'amazon.titan-embed-text-v1';
  const client = new BedrockRuntimeClient({ region: 'us-west-2' });
  const response = await client.send(new InvokeModelCommand({
    body: JSON.stringify({ inputText: input }),
    modelId: embeddingModelId,
    contentType: 'application/json',
    accept: 'application/json',
  }));
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.embedding;
}

/**
 * Endpoint to make requests using free text
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function freeTextQuery(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    // get the region, buffer (if any), property, time interval (if any), and output format
    // (if given) using AWS Bedrock
    const client = new BedrockRuntimeClient({ region: 'us-west-2' });

    const inputText = `
    Given the following text, identify the place of interest, the buffer radius,
    the time interval in ISO 8601 format, i.e., 'yyyy-MM-dd HH:mm:ss +zzzz',
    the measured property of interest, and the desired file format.
    If the time interval is present it should always be returned as an interval, not a single time.
    Format your response as a JSON file using 'N/A' for any fields that are not present.\n\n`
      + req.body.query;

    const titanConfig = {
      inputText,
      textGenerationConfig: {
        maxTokenCount: 4096,
        stopSequences: [],
        temperature: 0,
        topP: 1,
      },
    };

    const queryModelId = 'amazon.titan-text-express-v1';

    const response = await client.send(new InvokeModelCommand({
      body: JSON.stringify(titanConfig),
      modelId: queryModelId,
      contentType: 'application/json',
      accept: 'application/json',
    }));
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const output = responseBody.results[0].outputText;
    console.log(`OUTPUT: ${JSON.stringify(output, null, 2)}`);
    const modelOutput = parseModelOutput(output);

    let geoJson;

    if (modelOutput.placeOfInterest) {
      geoJson = await getGeoJsonByPlaceName(modelOutput.placeOfInterest);
      if (modelOutput.bufferUnits) {
        // Create the buffer around the polygon
        geoJson = buffer(geoJson, modelOutput.bufferNumber, { units: modelOutput.bufferUnits as Units });
      }
    }

    console.log(`GEOJSON: ${JSON.stringify(geoJson, null, 2)}`);


    const embedding = await getEmbedding(modelOutput.propertyOfInterest);

    const sql = `SELECT collection_id, variable_id, 1 - (embedding <=> '[${embedding}]') AS similarity FROM umm_embeddings ORDER BY embedding <=> '[${embedding}]' LIMIT 5;`;
    // const sql = `SELECT collection_id, variable_id, (embedding <-> '[${embedding}]') AS similarity FROM umm_embeddings ORDER BY embedding <-> '[${embedding}]' DESC LIMIT 5;`;


    const db = knex(knexfile);
    // const rows = await db('umm_embeddings')
    //   .orderBy(knex.l2Distance('embedding', embedding))
    //   .limit(1);
    const dbResult = await db.raw(sql);
    // console.log(JSON.stringify(dbResult, null, 2));

    for (const { collection_id, variable_id, similarity } of dbResult.rows) {
      console.log(`COLLECTION ID: ${collection_id}  VARIABLE ID: ${variable_id}  SIMILARITY: ${similarity}`);
    }

    const { collection_id, variable_id, similarity } = dbResult.rows[0];
    console.log(`BEST MATCH: COLLECTION ID: ${collection_id}  VARIABLE ID: ${variable_id}  SIMILARITY: ${similarity}`);

    res.send(modelOutput);

  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}