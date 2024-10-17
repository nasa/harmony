## Summary of Available Endpoints

All of the public endpoints for Harmony users other than the OGC Coverages, EDR, and WMS APIs are listed in the following table. The Coverages and WMS APIs are described in the [Using the Service APIs section](#using-the-service-apis).

| route                  | description                                                                                       |
|------------------------|---------------------------------------------------------------------------------------------------|
| /                      | The Harmony landing page                                                                          |
| /capabilities          | [Get harmony capabilities for the provided collection](#capabilities-details)                     |
| /cloud-access          | [Generates AWS credentials for accessing processed data in S3](#cloud-access-details)             |
| /docs                  | These documentation pages                                                                         |
| /docs/api              | The Swagger documentation for the OGC Coverages API                                               |
| /jobs                  | [The jobs API for getting job status, pausing/continuing/canceling jobs](#jobs-details)           |
| /stac                  | [The API for retrieving STAC catalog and catalog items for processed data](#stac-details)         |
| /staging-bucket-policy | [The policy generator for external (user) bucket storage](#user-owned-buckets-for-harmony-output) |
| /versions              | [Returns JSON indicating the image and tag each deployed service is running](#versions-details)   |
| /service-image-tag     | [The API for managing service image tags/versions](https://github.com/nasa/harmony/blob/main/docs/guides/managing-existing-services.md)|
| /workflow-ui           | The Workflow UI for monitoring and interacting with running jobs                                  |
---
**Table {{tableCounter}}** - Harmony routes other than OGC Coverages and WMS

<br/>
<br/>
