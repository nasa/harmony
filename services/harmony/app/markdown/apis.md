## Using the Service APIs
This section provides an introduction to the Harmony service APIs for launching services for collections using [OGC Coverages API](/docs/api), [OGC EDR API](/docs/edr-api), or WMS.

Each API requires a CMR collection concept ID or short name, and transformations can be performed using
one of the following endpoints ({collectionId} and {variable} are placeholders):


```

{{root}}/{collectionId}/ogc-api-coverages/1.0.0/{variable}/coverage/rangeset

```
**Example {{exampleCounter}}** - OGC Coverages endpoint

```

{{root}}/ogc-api-edr/1.1.0/collections/{collectionId}/cube

```
**Example {{exampleCounter}}** - OGC EDR cube endpoint

```

{{root}}/ogc-api-edr/1.1.0/collections/{collectionId}/area

```
**Example {{exampleCounter}}** - OGC EDR area endpoint

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

#### OGC EDR Request Parameters

The Harmony services REST API also conforms to the OGC EDR API version 1.1.0.
As such it accepts parameters in the URL path as well as query parameters.
Currently only the `/position`, `/cube` and `/area` routes are supported for spatial subsetting. Other EDR routes will be supported in the future.

##### URL Path Parameters
| parameter | description |
|-----------|-------------|
| collection | (required) This is the NASA EOSDIS collection or data product. There are two options for inputting a collection of interest:<br/>1. Provide a concept ID, which is an ID provided in the Common Metadata Repository (CMR) metadata<br/>2. Use the data product short name, e.g. SENTINEL-1_INTERFEROGRAMS. Must be URL encoded. |
---
**Table {{tableCounter}}** - Harmony OGC EDR API URL path (required) parameters

<br/>
<br/>

##### Common OGC EDR Query Parameters
| parameter | description |
|-----------|-------------|
| z | Define the vertical levels to return data from. The value will override any vertical values defined in the BBOX query parameter. A range to return data for all levels between and including 2 defined levels<br/>i.e. z=minimum value/maximum value. For instance if all values between and including 10m and 100m<br/>z=10/100<br/>A list of height values can be specified, i.e. z=value1,value2,value3. For instance if values at 2m, 10m and 80m are required<br/>z=2,10,80<br/>An Arithmetic sequence using Recurring height intervals, the difference is the number of recurrences is defined at the start and the amount to increment the height by is defined at the end, i.e. z=Rn/min height/height interval. So if the request was for 20 height levels 50m apart starting at 100m:<br/>z=R20/100/50<br/>When not specified data from all available heights SHOULD be returned |
| datetime | Either a date-time or an interval. Date and time expressions adhere to RFC 3339. Intervals may be bounded or half-bounded (double-dots at start or end).<br/>Examples:<br/>* A date-time: "2018-02-12T23:20:50Z"<br/>* A bounded interval: "2018-02-12T00:00:00Z/2018-03-18T12:31:12Z"<br/>* Half-bounded intervals: "2018-02-12T00:00:00Z/.." or "../2018-03-18T12:31:12Z"<br/>Only resources that have a temporal property that intersects the value of `datetime` are selected. If a feature has multiple temporal properties, it is the decision of the server whether only a single temporal property is used to determine the extent or all relevant temporal properties. |
| parameter-name | Names or concept ids of the UMM-Var variables to be retrieved. Without parameter-name or a value of "all" to retrieve all variables. <br/> Multiple variables may be retrieved by separating them with a comma. |
| crs | reproject the output coverage to the given CRS. Recognizes CRS types that can be  |inferred by gdal, including EPSG codes, Proj4 strings, and OGC EDR URLs (http://www.opengis.net/def/crs/...) |
| f | the mime-type of the output format to return |
---
**Table {{tableCounter}}** - Harmony OGC EDR API query parameters common to all spatial subsetting routes

##### Harmony Extended Query Parameters for OGC EDR Routes
| parameter | description |
|-----------|-------------|
| concatenate | requests results to be concatenated into a single result |
| forceAsync | if "true", override the default API behavior and always treat the request as asynchronous |
| destinationUrl | destination url specified by the client; currently only s3 link urls are  supported (e.g. s3://my-bucket-name/mypath) and will result in the job being run asynchronously |
| granuleId | the CMR Granule ID for the granule which should be retrieved |
| granuleName | passed to the CMR search as the readable_granule_name parameter. Supports * and ?  wildcards for multiple and single character matches. Wildcards can be used any place in the name, but leading wildcards are discouraged as they require a lot of resources for the underlying search |
| grid | the name of the output grid to use for regridding requests. The name must match the UMM  |grid name in the CMR.
| ignoreErrors | if "true", continue processing a request to completion even if some items fail. If "false" immediately fail the request. Defaults to true |
| interpolation | specify the interpolation method used during reprojection and scaling |
| maxResults | limits the number of input files processed in the request |
| scaleExtent | scale the resulting coverage along one axis to a given extent |
| scaleSize | scale the resulting coverage along one axis to a given size |
| skipPreview | if "true", override the default API behavior and never auto-pause jobs |
| subset | get a subset of the coverage by slicing or trimming along one axis. Harmony supports arbitrary dimension names for subsetting on numeric ranges for that dimension. |
| height | number of rows to return in the output coverage |
| width | number of columns to return in the output coverage |
---
**Table {{tableCounter}}** - Harmony extended parameters for all OGC EDR API routes

##### OGC EDR Cube Subsetting Query Parameters
| parameter | description |
|-----------|-------------|
| bbox | The bounding box is provided as four or six numbers, depending on whether the coordinate reference system includes a vertical axis (height or depth):<br/>* Lower left corner, coordinate axis 1<br/>* Lower left corner, coordinate axis 2<br/>* Minimum value, coordinate axis 3 (optional)<br/>* Upper right corner, coordinate axis 1<br/>* Upper right corner, coordinate axis 2<br/>* Maximum value, coordinate axis 3 (optional)<br/>The coordinate reference system of the values is WGS 84 longitude/latitude (http://www.opengis.net/def/crs/OGC/1.3/CRS84) unless a different coordinate reference system is specified in the parameter bbox-crs. For WGS 84 longitude/latitude the values are in most cases the sequence of minimum longitude, minimum latitude, maximum longitude and maximum latitude. However, in cases where the box spans the antimeridian the first value (west-most box edge) is larger than the third value (east-most box edge). If the vertical axis is included, the third and the sixth number are the bottom and the top of the 3-dimensional bounding box. If a feature has multiple spatial geometry properties, it is the decision of the server whether only a single spatial geometry property is used to determine the extent or all relevant geometries. |
---
**Table {{tableCounter}}** - OGC EDR API cube parameters

A sample OGC EDR cube request is as follows

```

curl -Lnbj {{root}}/ogc-api-edr/1.1.0/collections/{{exampleCollection}}/cube?maxResults=1

```
**Example {{exampleCounter}}** - Curl command for an OGC EDR cube request

##### OGC EDR Area Subsetting Query Parameters
| parameter | description |
|-----------|-------------|
| coords | (required) A Well Known Text (WKT) polygon or multi-polygon string. Coordinates MUST be in counter-clockwise order. |
---
**Table {{tableCounter}}** - OGC EDR API area parameters

A sample OGC EDR area request is as follows

```

curl -Lnbj {{root}}/ogc-api-edr/1.1.0/collections/{{exampleCollection}}/area?maxResults=1&parameter-name=all&coords=POLYGON%20%28%28-65.390625%20-13.239945%2C%20-29.882813%20-50.958427%2C%2017.929688%2030.145127%2C%20-65.
390625%20-13.239945%29%29

```
**Example {{exampleCounter}}** - Curl command for an OGC EDR area request

##### OGC EDR Position Subsetting Query Parameters
| parameter | description |
|-----------|-------------|
| coords | (required) A Well Known Text (WKT) point or multi-point string. |
---
**Table {{tableCounter}}** - OGC EDR API position parameters

A sample OGC EDR position request is as follows

```

curl -Lnbj {{root}}/ogc-api-edr/1.1.0/collections/{{exampleCollection}}/position?maxResults=1&parameter-name=all&coords=POINT%20(-40%2010)

```
**Example {{exampleCounter}}** - Curl command for an OGC EDR position request

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