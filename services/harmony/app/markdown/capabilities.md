### <a name="capabilities-details"></a> Get Harmony capabilities for the provided collection

Returns information related to what Harmony operations are supported for a given collection in JSON format. The collection can be identified by either collection concept id or short name.

##### <a name="query-parameters"></a> Query Parameters
Either `collectionId` or `shortName` must be provided.
| parameter    | description                                                                                   |
|--------------|-----------------------------------------------------------------------------------------------|
| collectionId | Concept id of the collection to retrieve capabilities for                                     |
| shortName    | Short name of the collection to retrieve capabilities for                                     |
| version      | (optional) The version of the capabilities result format, currently only 1 or 2 is supported. |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint parameters

##### <a name="response"></a> Response
The returned JSON response will have the configured capabilities in Harmony for the given collection in terms of supported features (e.g. variable subsetting, boundingbox subsetting, concatenation, reprojection, etc.), the output formats, the list of Harmony services that are applicable for the collection, the list of variables that are associated with the collection and the version of the capabilites result format. See below for the root level fields in the capabilites response and their descriptions:

| field               | description                                                                                               |
|---------------------|-----------------------------------------------------------------------------------------------------------|
| conceptId           | Concept id of the collection                                                                              |
| shortName           | Short name of the collection                                                                              |
| variableSubset      | (boolean) True if variable subsetting is supported by any of the Harmony services for the collection.     |
| bboxSubset          | (boolean) True if bounding box subsetting is supported by any of the Harmony services for the collection. |
| shapeSubset         | (boolean) True if shape file subsetting is supported by any of the Harmony services for the collection.   |
| concatenate         | (boolean) True if concatenation is supported by any of the Harmony services for the collection.           |
| reproject           | (boolean) True if reprojection is supported by any of the Harmony services for the collection.            |
| outputFormats       | A list of supported output formats for the collection.                                                    |
| services            | A list of JSON objects describing the supported Harmony services for the collection.                      |
| variables           | A list of JSON objects describing the associated variables of the collection.                             |
| capabilitiesVersion | The version of the capabilities result format.                                                            |
---
**Table {{tableCounter}}** - Harmony capabilities endpoint response fields

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
