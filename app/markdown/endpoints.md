## Summary of Available Endpoints

All of the public endpoints for Harmony users other than the OCG Coverages and WMS APIs are listed in the following table. The Coverages and WMS APIs are described in the next section.

| route                  | description                                                                       |
|------------------------|-----------------------------------------------------------------------------------|
| /                      | The Harmony landing page                                                          |
| /capabilities          | Returns JSON detailing the harmony capabilities for the provided collection       |
| /cloud-access          | Generates JSON with temporary credentials for accessing processed data in S3      |
| /cloud-access.sh       | Generates shell scripts that can be run to access processed data in S3            |
| /docs                  | These documentation pages                                                         |
| /docs/api              | The Swagger documentation for the OGC Coverages API                               |
| /jobs                  | The jobs API for getting job status, pausing/continuing/canceling jobs            |
| /stac                  | The API for retrieving STAC catalogs and catalog items for processed data         |
| /staging-bucket-policy | The policy generator for external (user) bucket storage                           |
| /versions              | Returns JSON indicating what version (image tag) each deployed service is running |
| /workflow-ui           | The Workflow UI for monitoring and interacting with running jobs                                                                   |
---
**Table {{tableCounter}}** - Harmony routes other than OCG Coverages and WMS



The remaining routes are for launching services for collections using either OCG Coverages or WMS and
are discussed in the next section.

<br/>
<br/>
