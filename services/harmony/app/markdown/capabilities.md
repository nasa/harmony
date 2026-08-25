### <a name="capabilities-details"></a> Get Harmony capabilities for the provided collection

Returns information related to what Harmony operations are supported for a given collection in JSON format. The collection can be identified by either collection concept id or short name.

##### <a name="query-parameters"></a> Query Parameters
Either `collectionId` or `shortName` must be provided.
| parameter    | description |
|--------------|-------------|
| collectionId | Concept ID of the collection to retrieve capabilities for |
| shortName    | Short name of the collection to retrieve capabilities for |
| version      | (optional) The version of the capabilities result format. Currently 1, 2, and 3 are supported. Version 3 is the default. |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint parameters

##### <a name="response"></a> Response
The returned JSON response will have the configured capabilities in Harmony for the given collection in terms of supported features (e.g. variable subsetting, bounding box subsetting, concatenation, reprojection, etc.), the output formats, the list of Harmony services that are applicable for the collection, the list of variables that are associated with the collection and the version of the capabilities result format. 

###### <a name="response-v3"></a> Version 3
See below for the root level fields in the capabilities response and their descriptions for version 3:

| field               | description |
|---------------------|-------------|
| conceptId           | Concept ID of the collection. |
| shortName           | Short name of the collection. |
| summary             | A JSON object summarizing the Harmony capabilities available for the collection, including subsetting, reprojection, averaging, concatenation, and supported output formats. Some capabilities cannot be used together; see the `services` field to determine the capabilities supported by individual services and valid capability combinations. |
| services            | A list of JSON objects describing the Harmony services applicable to the collection. Each service includes its name, reference URL, and the capabilities supported by that service. |
| variables           | A list of JSON objects describing the variables associated with the collection. |
| capabilitiesVersion | The version identifier for the capabilities response format. |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint response version 3 fields

###### <a name="response-v2"></a> Version 2
See below for the root level fields in the capabilities response and their descriptions for version 2:

| field               | description |
|---------------------|-------------|
| conceptId           | Concept ID of the collection. |
| shortName           | Short name of the collection. |
| variableSubset      | (boolean) True if variable subsetting is supported by any of the Harmony services for the collection. |
| bboxSubset          | (boolean) True if bounding box subsetting is supported by any of the Harmony services for the collection. |
| shapeSubset         | (boolean) True if shape subsetting is supported by any of the Harmony services for the collection. |
| temporalSubset      | (boolean) True if temporal subsetting is supported by any of the Harmony services for the collection. |
| concatenate         | (boolean) True if concatenation is supported by any of the Harmony services for the collection. |
| reproject           | (boolean) True if reprojection is supported by any of the Harmony services for the collection. |
| outputFormats       | A list of supported output format MIME types for the collection. |
| services            | A list of JSON objects describing the Harmony services applicable to the collection and their supported capabilities. |
| variables           | A list of JSON objects describing the variables associated with the collection. |
| capabilitiesVersion | The version identifier for the capabilities response format. |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint response version 2 fields

###### <a name="response-v1"></a> Version 1
See below for the root level fields in the capabilities response and their descriptions for version 1:

| field               | description |
|---------------------|-------------|
| conceptId           | Concept ID of the collection. |
| shortName           | Short name of the collection. |
| variableSubset      | (boolean) True if variable subsetting is supported by any of the Harmony services for the collection. |
| bboxSubset          | (boolean) True if bounding box subsetting is supported by any of the Harmony services for the collection. |
| shapeSubset         | (boolean) True if shape subsetting is supported by any of the Harmony services for the collection. |
| temporalSubset      | (boolean) True if temporal subsetting is supported by any of the Harmony services for the collection. |
| concatenate         | (boolean) True if concatenation is supported by any of the Harmony services for the collection. |
| reproject           | (boolean) True if reprojection is supported by any of the Harmony services for the collection. |
| outputFormats       | A list of supported output format MIME types for the collection. |
| services            | A list of JSON objects describing the Harmony services applicable to the collection and their supported capabilities. |
| variables           | A list of variable names associated with the collection. |
| capabilitiesVersion | The version identifier for the capabilities response format. |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint response version 1 fields

#### Getting Harmony capabilities for a given collection by collection concept id

```

{{root}}/capabilities?collectionId=<collection-concept-id>

```
**Example {{exampleCounter}}** - Getting Harmony capabilities for a given collection by collection concept id

#### Getting Harmony capabilities for a given collection by collection short name

```

{{root}}/capabilities?shortName=<collection-short-name>

```
**Example {{exampleCounter}}** - Getting Harmony capabilities for a given collection by collection short name
