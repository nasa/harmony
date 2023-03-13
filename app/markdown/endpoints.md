## Summary of Available Endpoints

All of the public endpoints for Harmony users other than the OGC and WMS APIs are listed in the following table.

| route                  | description                                                         |
|------------------------|---------------------------------------------------------------------|
| /                      | The Harmony landing page
| /capabilities          | Get the list of capabilities available for a given collection |                                        |
| /cloud-access          | Generates JSON with temporary credentials for accessing staged data |
| /cloud-access.sh       | Generates shell scripts that can be run to access staged data       |
| /docs                  | These documentation pages                                           |
| /docs/api              | The Swagger documentation for the request APIs                      |
| /jobs                  | The jobs API for getting job status, pausing/continuing/stopping jobs           |
| /stac                  | The API for retrieving STAC catalogs and catalog items for processed data           |
| /staging-bucket-policy | The policy generator for external (user) bucket storage             |
| /versions              | Returns JSON indicating what version (image tag) each deployed service is running |
| /workflow-ui           | The Workflow UI                                                     |
---
**Table {{tableCounter}}** - Harmony routes other than OGC and WMS

The remaining routes are for launching services for collections using either OGC or WMS and
are discussed in the next section.

<br/>
<br/>
