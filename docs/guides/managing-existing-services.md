# Managing Service Image Tags (Versions)

Using the `/service-image-tag` endpoint, service providers can manage the versions of their services deployed to an environment.

>**Note** a user must be a member of either the EDL `Harmony Service Deployers`
group or the EDL `Harmony Admin` group to access this endpoint.

## Get backend service tag (version) information for all services

```
curl -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-image-tag
```
**Example 1** - Getting backend service image tags using the `/service-image-tag` API

The returned JSON response is a map of canonical service names to tags:

```JSON
{
  "service-runner": "latest",
  "harmony-gdal-adapter": "latest",
  "hybig": "latest",
  "harmony-service-example": "latest",
  "harmony-netcdf-to-zarr": "latest",
  "harmony-regridder": "latest",
  "harmony-smap-l2-gridder": "latest",
  "swath-projector": "latest",
  "hoss": "latest",
  "sds-maskfill": "latest",
  "trajectory-subsetter": "latest",
  "podaac-concise": "sit",
  "podaac-l2-subsetter": "sit",
  "podaac-ps3": "latest",
  "podaac-netcdf-converter": "latest",
  "query-cmr": "latest",
  "giovanni-time-series-adapter": "latest",
  "geoloco": "latest",
  "subset-band-name": "latest"
}
```
**Example 2** - Harmony `/service-image-tag` response

## Get backend service tag (version) information for a specific service

```
curl -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-image-tag/#canonical-service-name
```
**Example 3** - Getting a specific backend service image tag using the `/service-image-tag` API

The returned JSON response is a map with a single `tag` field:

```JSON
{
  "tag": "1.2.3"
}
```
**Example 4** - Harmony `/service-image-tag` response for a single service

## Update backend service tag (version) for a specific service

You can manage the version/tag of a service using a `PUT` action with the endpoint. `PUT` requests to this endpoint _must_ include
an EDL [bearer token](https://uat.urs.earthdata.nasa.gov/documentation/for_users/user_token) header, .e.g., `Authorization: Bearer <token>`.
Be sure to obtain the token for the correct environment, e.g., use `uat.urs.earthdata.nasa.gov` for SIT and UAT environments, and `urs.earthdata.nasa.gov`
for Production.

For example:

```
curl -XPUT https://harmony.uat.earthdata.nasa.gov/service-image-tag/#canonical-service-name  -H 'Authorization: Bearer <your bearer token>'  -d '{"tag": "new-version"}' -H 'Content-type: application/json'
```
**Example 5** - Updating a specific backend service image tag using the `/service-image-tag` API

The body of the `PUT` request should be a JSON object with a `tag` field indicating the tag of the updated service image and an optional `regression_test_version` field with the value of the tag of the regression test docker image, the value 'latest' will be used when `regression_test_version` field is omitted.

```JSON
{
  "tag": "new-version",
  "regression_test_version": "1.0.0"
}
```
**Example 6** - Harmony `/service-image-tag` request body for updating a tag

The returned JSON response has a tag field indicating the new tag value and a statusLink field with the url for getting the status of the service image deployment.

```JSON
{
  "tag": "new-version",
  "statusLink": "https://harmony.uat.earthdata.nasa.gov/service-deployment/<deployment-id>"
}
```
**Example 7** - Harmony `/service-image-tag` response for a updating a single service

>**Note** this is an asynchronous request, so the status code for the response will be `202 Accepted` - it may take several minutes for the entire update to complete.

Only one service deployment can be run at any given time. If your request is rejected with error message: `Service deployment is disabled.`, it might be because either a Harmony deployment or another service deployment is running. Please wait for a few minutes, then retry your request. If the problem persists, contact Harmony support.

Harmony validates that the image and tag are reachable - an error will be returned if not.

**Important** from the [Docker documentation](https://docs.docker.com/engine/reference/commandline/image_tag/):
>A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.

## Get backend service image tag update status

You can get the status of backend service tag update by following the `statusLink` returned in the backend service tag update response.

For example:

```
curl -XGET -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-deployment/<deployment-id>
```
**Example 8** - Get service image tag update status

The returned JSON response has the fields indicating the current status of the service image deployment. The service deployment log can be viewed via the link provided in `message` once the deployment is complete.

```JSON
{
  "deploymentId": "befb50e0-e467-4776-86c8-e7218f1123cc",
  "username": "yliu10",
  "service": "harmony-service-example",
  "tag": "new-version",
  "regressionTestVersion": "1.0.0",
  "status": "successful",
  "message": "Deployment successful. See details at: https://harmony.uat.earthdata.nasa.gov/deployment-logs/befb50e0-e467-4776-86c8-e7218f1123cc",
  "createdAt": "2024-03-29T14:56:29.151Z",
  "updatedAt": "2024-03-29T14:56:29.273Z"
}
```
**Example 9** - Harmony get status of service image tag update response

## Get the current enable/disable state of the service deployment feature

```

GET https://harmony.uat.earthdata.nasa.gov/service-deployments-state

```
**Example 10** - Getting the current enable/disable state of the service deployment feature using the `service-deployments-state` API

The returned JSON response shows if the service deployment is currently enabled (true) or disabled (false) and any optional message:

```JSON
{
  "enabled": true,
  "message": "Manually enabled by David"
}
```
---
**Example 11** - Harmony `service-deployments-state` response for enable/disable state

## Enable the service deployment feature
The user must have admin permission in order to invoke this endpoint. User can provide an optional message in the JSON body to indicate the reason for enabling. This message will be persisted in database and returned when user retrieves the service deployment state later.

For example:

```
curl -XPUT -H 'Authorization: Bearer <your bearer token>' -H 'Content-type: application/json' https://harmony.uat.earthdata.nasa.gov/service-deployments-state -d '{"enabled": true, "message": "Manually enabled by David"}'
```
---
**Example 12** - Harmony `service-deployments-state` request for enabling the service deployment

The returned JSON response is the same as the get current state of the service deployment feature request above, indicating the current state:

```JSON
{
  "enabled": true,
  "message": "Manually enabled by David"
}
```
**Example 13** - Harmony `/service-deployments-state` response for enabling the service deployment

## Disable the service deployment feature
The user must have admin permission in order to invoke this endpoint. User can provide an optional message in the JSON body to indicate the reason for disabling. This message will be persisted in database and returned when user retrieves the service deployment state later.

For example:

```
curl -XPUT -H 'Authorization: Bearer <your bearer token>' -H 'Content-type: application/json' https://harmony.uat.earthdata.nasa.gov/service-deployments-state -d '{"enabled": false, "message": "Manually disabled by David"}'
```
---
**Example 14** - Harmony `service-deployments-state` request for disabling the service deployment

The returned JSON response is the same as the get current state of the service deployment feature request above, indicating the current state:

```JSON
{
  "enabled": false,
  "message": "Manually disabled by David"
}
```
**Example 15** - Harmony `/service-deployments-state` response for disabling the service deployment

## Getting the Deployment History for All Services
```
curl -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-deployment
```

## Getting the Deployment History for a Given Service

```
curl -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-deployment?service=harmony-service-example
```

## Getting the Deployment History for Service Deployments with a Given Status
```
curl -Ln -bj https://harmony.uat.earthdata.nasa.gov/service-deployment?status=running
```

Valid statuses are "running", "successful", and "failed".

**Note** the deployment histories do not include information about normal (full) Harmony deployments.
