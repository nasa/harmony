/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response, NextFunction } from 'express';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import fetch from 'node-fetch';
import FormData from 'form-data';
import axios from 'axios';
import { Readable } from 'stream';
import { buffer, Units } from '@turf/turf';
import { v4 as uuid } from 'uuid';
import { CmrQuery, queryCollectionUsingMultipartForm } from '../util/cmr';
import env from '../util/env';
import { keysToLowerCase } from '../util/object';
import { defaultObjectStore } from '../util/object-store';
import HarmonyRequest from '../models/harmony-request';
import { parseNumber } from '../util/parameter-parsing-helpers';
import knexfile from '../../../../db/knexfile';
import { knex } from 'knex';
import * as querystring from 'querystring';
import { Logger } from 'winston';
// import { FileStore } from '../util/object-store/file-store';

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
  propertyOfInterest: string;
  placeOfInterest: string | null;
  bufferNumber: number | null;
  bufferUnits: string | null;
  collection: string;
  collectionName: string;
  variable: string;
  variableName: string;
  variableDefinition: string;
  timeInterval: string | null;
  outputFormat: string | null;
  geoJson: string | null;
  statusUrl: string;
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
  const rawOutputJson = keysToLowerCase(JSON.parse(rawOutputLines.join('\n')).rows[0]);

  const placeOfInterest = rawOutputJson['place of interest'] === 'N/A' ? null : rawOutputJson['place of interest'];
  const bufferStr: string = rawOutputJson['buffer radius'];
  let bufferNumber;
  let bufferUnits;
  if (bufferStr != 'N/A') {
    bufferNumber = parseNumber(bufferStr.split(' ')[0]);
    bufferUnits = distanceUnits[bufferStr.split(' ')[1]];
  }
  const timeInterval = rawOutputJson['time interval'] === 'N/A' ? null : rawOutputJson['time interval'];
  const outputFormat = rawOutputJson['file format'] == 'N/A' ? null : rawOutputJson['file format'];

  return {
    propertyOfInterest: rawOutputJson['measured property of interest'],
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
 * Create a token header for the given access token string
 *
 * @param token - The access token for the user
 * @returns An object with an 'Authorization' key and 'Bearer token' as the value,
 * or an empty object if the token is not set
 */
function _makeTokenHeader(token: string): object {
  return { Authorization: `Bearer ${token}` };
}

interface HarmonyJobStatus {
  links: Array<{
    href: string;
    [key: string]: any; // allows additional fields in each link object
  }>;
  [key: string]: any; // allows additional top-level fields in the status object
}

/**
 * TODO
 */
async function submitHarmonyRequest(collection, variable, queryParams, geoJson: string, token): Promise<HarmonyJobStatus> {
  queryParams.forceAsync = true;
  queryParams.maxResults = 1;
  const encodedVariable = encodeURIComponent(variable);
  const baseUrl = `http://localhost:3000/${collection}/ogc-api-coverages/1.0.0/collections/${encodedVariable}/coverage/rangeset`;
  const querystr = querystring.stringify(queryParams);
  const headers = {
    ..._makeTokenHeader(token),
    'Content-Type': 'multipart/form-data'
  };

  const formData = new FormData();
  // const readable = new Readable();
  // readable.push(geoJson);
  // readable.push(null);
  const readableStream = Readable.from(JSON.stringify(geoJson));

  // formData.append('shapefile', readableStream );
  // formData.append('shapefile', new Blob([geoJson]));
  formData.append('shapefile', JSON.stringify(geoJson), {
    filename: 'data.geojson',
    contentType: 'application/geo+json',
  });

  console.log(`Making request to ${baseUrl}?${querystr}`);

  const response = await axios.post(`${baseUrl}?${querystr}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...headers
    }
  });

  // const response = await fetch(`${baseUrl}?${querystr}`,
  //   {
  //     method: 'POST',
  //     headers,
  //     body: formData,
  //   });
  // const response = await axios.post(`${baseUrl}?${querystr}`, formData, {
  //   headers
  // });
  // const response = await axios.post(`${baseUrl}?${querystr}`, {
  //     shapefile: readableStream,
  // },
  //   { ...headers}
  // );
  // console.log(`RESPONSE ${JSON.stringify(response, null, 2)}`);
  const data = await response.data;
  console.log(JSON.stringify(data));
  // return await response.json();
  return data;
}

let globalLogger: Logger;

/**
 * Log performance
 */
function logPerf(startTime, msg): DOMHighResTimeStamp {
  const endTime = performance.now();
  globalLogger.info(`PERF: ${(endTime - startTime).toFixed(0)} ms for ${msg}`);
  return endTime;
}
/**
 * Endpoint to make requests using free text
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function freeTextQueryPost(
  req: HarmonyRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    globalLogger = req.context.logger;
    // get the region, buffer (if any), property, time interval (if any), and output format
    // (if given) using AWS Bedrock
    let now = performance.now();
    const client = new BedrockRuntimeClient({ region: 'us-west-2' });
    now = logPerf(now, 'create bedrock client');
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
    now = logPerf(now, 'query bedrock to parse user query');
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const output = responseBody.results[0].outputText;
    console.log(`OUTPUT: ${JSON.stringify(output, null, 2)}`);
    const modelOutput = parseModelOutput(output);
    now = logPerf(now, 'parse bedrock response');
    console.log(`modelOutput: ${JSON.stringify(modelOutput)}`);

    let geoJson;

    if (modelOutput.placeOfInterest) {
      geoJson = await getGeoJsonByPlaceName(modelOutput.placeOfInterest);
      if (modelOutput.bufferUnits) {
        // Create the buffer around the polygon
        geoJson = buffer(geoJson, modelOutput.bufferNumber, { units: modelOutput.bufferUnits as Units });
      }
      now = logPerf(now, 'Get GeoJSON from place name');
    }

    // console.log(`GEOJSON: ${JSON.stringify(geoJson, null, 2)}`);

    const store = defaultObjectStore();
    // const store = new FileStore();
    const prefix = `public/free-text-${uuid()}`;
    // const url = defaultObjectStore().getUrlString({ bucket: env.artifactBucket, key: prefix });
    const url = store.getUrlString({ bucket: env.artifactBucket, key: prefix });
    await store.upload(JSON.stringify(geoJson), url);
    now = logPerf(now, 'upload shape to S3');

    const embedding = await getEmbedding(modelOutput.propertyOfInterest);
    now = logPerf(now, 'generate embedding based on property of interest');

    // const sql = `SELECT collection_id, collection_name, variable_id, variable_name, variable_definition, 1 - (embedding <=> '[${embedding}]') AS similarity FROM umm_embeddings ORDER BY embedding <=> '[${embedding}]' LIMIT 50;`;

    const sql = `SELECT collection_id, collection_name, variable_id, variable_name, variable_definition, 1 - (embedding <=> '[${embedding}]') AS similarity FROM umm_embeddings ORDER BY embedding <=> '[${embedding}]' LIMIT 10;`;
    // const sql = `SELECT collection_id, variable_id, (embedding <-> '[${embedding}]') AS similarity FROM umm_embeddings ORDER BY embedding <-> '[${embedding}]' DESC LIMIT 5;`;

    const db = knex(knexfile);

    const dbResult = await db.raw(sql);

    now = logPerf(now, 'query database for embedding similarity');
    // console.log(JSON.stringify(dbResult, null, 2));

    for (const { collection_id, collection_name, variable_id, variable_name, similarity } of dbResult.rows) {
      console.log(`COLLECTION ID: ${collection_id}  COLLECTION NAME: ${collection_name} VARIABLE ID: ${variable_id}  VARIABLE NAME: ${variable_name} SIMILARITY: ${similarity}`);
    }

    const conceptIds = dbResult.rows.map(a => a.collection_id);
    const conceptIdsSet = new Set(conceptIds);
    const conceptIdsArray = Array.from(conceptIdsSet) as string[];
    const temporalParam = modelOutput.timeInterval?.replace(/\+00:00/g, '').replace('/', ',');

    const collQuery: CmrQuery = {
      concept_id: conceptIdsArray,
      geojson: url,
      page_size: 100,
      temporal: temporalParam,
      include_granule_counts: 'true',
      'simplify-shapefile': 'true',
    };

    const collsWithGranules = await queryCollectionUsingMultipartForm({}, collQuery, req.accessToken);

    // // Run all queries in parallel
    // const queries = conceptIdsArray.map((conceptId) => {
    //   const collQuery: CmrQuery = {
    //     concept_id: conceptId,
    //     geojson: url,
    //     page_size: 100,
    //     temporal: temporalParam,
    //     include_granule_counts: 'true',
    //     'simplify-shapefile': 'true',
    //   };

    //   return queryCollectionUsingMultipartForm({}, collQuery, req.accessToken);
    // });
    // const results = await Promise.all(queries);

    // const collsWithGranules = results.flatMap(result => result.collections);

    now = logPerf(now, 'query CMR for granule counts for collections');

    // list of collection concept ids that has granule found with the spatial and temporal search
    // collsWithGranules.map(c => console.log(`Collection ${c.id} has ${c.granule_count} granules.`));
    // const collConceptIds = collsWithGranules.filter(c => c.granule_count > 0).map(c => c.id);
    collsWithGranules.collections.map(c => console.log(`Collection ${c.id} has ${c.granule_count} granules.`));
    const collConceptIds = collsWithGranules.collections.filter(c => c.granule_count > 0).map(c => c.id);
    console.log(`Collections with granules matching spatial and temporal search: ${JSON.stringify(collConceptIds)}`);

    let collectionId = null;
    let collectionName = null;
    let variableId = null;
    let variableName = null;
    let variableDefinition = null;

    // The first collection in the embedding query result that has granules is the best match
    if (dbResult.rows && collConceptIds.length > 0) {
      const { collection_id, collection_name, variable_id, variable_name, variable_definition, similarity } = dbResult.rows.find(item => collConceptIds.includes(item.collection_id));
      collectionId = collection_id;
      collectionName = collection_name;
      variableId = variable_id;
      variableName = variable_name;
      variableDefinition = variable_definition;
      console.log(`BEST MATCH: COLLECTION ID: ${collection_id}  VARIABLE ID: ${variable_id}  SIMILARITY: ${similarity}`);
    } else {
      console.log('No matching collections are found');
    }

    // Submit the request off to harmony - TODO figure out shapefile and temporal
    // const temporal = getTemporalQueryParam(temporalParam);
    const queryParams = {} as unknown as any;
    if (modelOutput.outputFormat) {
      queryParams.format = modelOutput.outputFormat;
    }

    const harmonyJob = await submitHarmonyRequest(collectionId, variableId, queryParams, geoJson, req.accessToken);
    logPerf(now, 'submit harmony request');
    const harmonyParams: GeneratedHarmonyRequestParameters = {
      propertyOfInterest: modelOutput.propertyOfInterest,
      placeOfInterest: modelOutput.placeOfInterest,
      bufferNumber: modelOutput.bufferNumber,
      bufferUnits: modelOutput.bufferUnits,
      collection: collectionId,
      collectionName,
      variable: variableId,
      variableName,
      variableDefinition,
      timeInterval: modelOutput.timeInterval,
      outputFormat: modelOutput.outputFormat,
      geoJson,
      statusUrl: harmonyJob.links[2].href,
    };

    res.send(harmonyParams);

  } catch (e) {
    req.context.logger.error(e);
    next(e);
  }
}

/**
 * Endpoint to make requests using free text
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next function in the call chain
 * @returns The job links (pause, resume, etc.)
 */
export async function freeTextQueryGet(
  _req: HarmonyRequest, res: Response, _next: NextFunction,
): Promise<void> {
  res.render('free-text-query/index', {
  });
}