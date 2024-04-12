## Using the Service APIs
This section provides an introduction to the Harmony service APIs for launching services for collections using either OGC Coverages or WMS. For more details on the OGC Coverages API see the [API Documentation](/docs/api).

Each API requires a CMR collection concept ID or short name, and transformations can be performed using
one of the following endpoints ({collectionId} and {variable} are placeholders):


```

{{root}}/{collectionId}/ogc-api-coverages/1.0.0/{variable}/coverage/rangeset

```
**Example {{exampleCounter}}** - OGC Coverages endpoint

```

{{root}}/{collectionId}/wms

```
**Example {{exampleCounter}}** - WMS endpoint

#### OGC Coverages Request Parameters

The primary Harmony services REST API conforms to the OGC Coverages API version 1.0.0.
As such it accepts parameters in the URL path as well as query parameters.

##### URL Path Parameters
| parameter | description |
|-----------|-------------|
| collection | (required) This is the NASA EOSDIS collection or data product. There are two options for inputting a collection of interest:<br/>1. Provide a concept ID, which is an ID provided in the Common Metadata Repository (CMR) metadata<br/>2. Use the data product short name, e.g. SENTINEL-1_INTERFEROGRAMS. Must be URL encoded. |
| variable | (required) Names or concept ids of the UMM-Var variables to be retrieved, or "all" to retrieve all variables.<br/> Multiple variables may be retrieved by separating them with a comma.<br/>The psuedo-variable "parameter_vars" may be used, in which case the variables are specified using the `variable` query parameter or `variable` form data parameter. This is useful if you need to subset using many variables. |
---
**Table {{tableCounter}}** - Harmony OGC Coverages API URL path (required) parameters

<br/>
<br/>

##### Query Parameters
| parameter | description |
|-----------|-------------|
| subset | get a subset of the coverage by slicing or trimming along one axis. Harmony supports  the axes "lat" and "lon" for spatial subsetting, and "time" for temporal, regardless of the names of those axes in the data files. Harmony also supports arbitrary dimension names for subsetting on numeric ranges for that dimension. |
| outputCrs | reproject the output coverage to the given CRS. Recognizes CRS types that can be  |inferred by gdal, including EPSG codes, Proj4 strings, and OGC Coverages URLs (http://www.opengis.net/def/crs/...) |
| interpolation | specify the interpolation method used during reprojection and scaling |
| scaleExtent | scale the resulting coverage along one axis to a given extent |
| scaleSize | scale the resulting coverage along one axis to a given size |
| concatenate | requests results to be concatenated into a single result |
| granuleId | the CMR Granule ID for the granule which should be retrieved |
| granuleName | passed to the CMR search as the readable_granule_name parameter. Supports * and ?  wildcards for multiple and single character matches. Wildcards can be used any place in the name, but leading wildcards are discouraged as they require a lot of resources for the underlying search |
| grid | the name of the output grid to use for regridding requests. The name must match the UMM  |grid name in the CMR.
| point | only collections that have a geometry that contains a spatial point are selected. The spatial point is provided as two numbers:<br/>* Longitude, coordinate axis 1<br/>* Latitude, coordinate axis 2<br/>The coordinate reference system of the values is [WGS84 longitude/latitude](http://www.opengis.net/def/crs/OGC/1.3/CRS84). |
| width | number of columns to return in the output coverage |
| height | number of rows to return in the output coverage |
| forceAsync | if "true", override the default API behavior and always treat the request as asynchronous |
| format | the mime-type of the output format to return |
| maxResults | limits the number of input files processed in the request |
| skipPreview | if "true", override the default API behavior and never auto-pause jobs |
| ignoreErrors | if "true", continue processing a request to completion even if some items fail. If "false" immediately fail the request. Defaults to true |
| destinationUrl | destination url specified by the client; currently only s3 link urls are  supported (e.g. s3://my-bucket-name/mypath) and will result in the job being run asynchronously |
| variable | the variable(s) to be used for variable subsetting. Multiple variables can be specified as a comma-separated list. This parameter is only used if the url `variable` path element is "parameter_vars" |
---
**Table {{tableCounter}}** - Harmony OGC Coverages API query parameters

For `POST` requests the body should be `multipart/form-data` and may also contain
* `shape`: perform a shapefile subsetting request on a supported collection by passing the path to a GeoJSON file (*.json or .geojson), an ESRI Shapefile (.zip or .shz), or a kml file (.kml) as the "shape" parameter

A sample OGC Coverages request is as follows

```

curl -Lnbj {{root}}/{{exampleCollection}}/ogc-api-coverages/1.0.0/collections/bathymetry/coverage/rangeset?maxResults=1

```
**Example {{exampleCounter}}** - Curl command for an OGC Coverages request

#### WMS Requests

Harmony provides an implementation of the [OGC Web Map Service (WMS) API](https://www.ogc.org/standard/wms/) version 1.3.0. Harmony only supports the `GetCapabilities` and `GetMap` requests.

The API uses both URL path and query parameters.

##### URL Path Parameters

| parameter | required    | description |
|-----------|-------------|-------------|
| collection | Y | this parameter is the same as the `collection` parameter described in the OGC Coverages API above. |
---
**Table {{tableCounter}}** - Harmony WMS API URL path (required) parameters

##### Common Query Parameters

| parameter | required | description                                                                |
|-----------|----------|----------------------------------------------------------------------------|
| service   | Y        | the service for the request. Must be equal to 'WMS'                        |
| version   | Y        | the WMS version to use. Must be equal to '1.3.0'                           |
| request   | Y        | the action being requested. Valid values are `GetCapabilities` and `GetMap` |
---
**Table {{tableCounter}}** - Required query parameters for both `GetCapabilities` and `GetMap`

##### Query Parameters for GetMap - Standard WMS
| parameter | required    | description |
|-----------|-------------|-------------|
| layers | Y | comma-separated list of layer names to display on map |
| bbox | Y | the bounding box for the map as comma separated values in WSEN order |
| crs | Y | Spatial Reference System for map output. Value is in form EPSG:nnn |
| format | Y | output format mime-type |
| styles | Y | Styles in which layers are to be rendered. Value is a comma-separated list of style names, or empty if default styling is required. Style names may be empty in the list, to use default layer styling. |
| width | Y | width in pixels of the output |
| height | Y | height in pixels of the output |
| bgcolor | N | Background color for the map image. Value is in the form RRGGBB. Default is FFFFFF (white). |
| exceptions | N | Format in which to report exceptions. Default value is application/vnd.ogc.se_xml |
| transparent | N | whether the output background should be transparent (`true` or `false`). default is `false` |
---
**Table {{tableCounter}}** - Standard WMS query parameters for `GetMap`

##### Additional Harmony parameters for WMS requests
| parameter | required    | description |
|-----------|-------------|-------------|
| dpi | N | the dots-per-inch (DPI) resolution for image output |
| map_resolution | N | the DPI resolution for image output |
| granuleId | N | the CMR Granule ID for the granule of interest |
| granuleName | N | passed to the CMR search as the readable_granule_name parameter. Supports * and ?  wildcards for multiple and single character matches. Wildcards can be used any place in the name, but leading wildcards are discouraged as they require a lot of resources for the underlying search |
---
**Table {{tableCounter}}** - Additional (non-OGC) query parameters for Harmony WMS queries

`GetCapabilities` requests return an XML document, while `GetMap` requests return an image.

<!--- LEAVING THIS HERE - UNCOMMENT/UPDATE WHEN WE GET WMS WORKING IN PROD
Here is a sample `GetMap` request:

```

http://localhost:3000/C1233800302-EEDTEST/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=-180,-90,154.4170924291685765,90&CRS=CRS%3A84&WIDTH=2000&HEIGHT=1078&LAYERS=C1233800302-EEDTEST&STYLES&FORMAT=image%2Fpng&DPI=72&MAP_RESOLUTION=72&TRANSPARENT=TRUE&granuleId=G1233800343-EEDTEST

```
**Example {{exampleCounter}}** - A sample WMS request
-->

<br/>
<br/>