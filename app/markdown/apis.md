## Using the Service APIs
This section provides an introduction to the Harmony service APIs. For details see the [API Documentation](/docs/api).

Each API requires a CMR collection concept ID with which transformations can be performed using
one of the following endpoints:


```

{{root}}/<collection-id>/ogc-api-coverages/1.0.0/<variable>/coverage/rangeset

```
**Example {{exampleCounter}}** - OGC coverages endpoint

```

{{root}}/<collection-id>/wms

```
**Example {{exampleCounter}}** - WMS endpoint

#### OGC Request Parameters

##### URL Path Parameters
* `collection`: required URL parameter. This is the NASA EOSDIS collection, or data product. There are two options for inputting a collection of interest:
    1. Provide a concept ID, which is an ID provided in the Common Metadata Repository (CMR) metadata
    2. Data product short name, e.g. SENTINEL-1_INTERFEROGRAMS. Must be URL encoded.
* `variable`: required URL parameter. Names of the UMM-Var variables to be retrieved, or "all" to retrieve all variables.
  Multiple variables may be retrieved by separating them with a comma.
##### Query Parameters
* `subset`: get a subset of the coverage by slicing or trimming among one axis. Harmony supports the axes "lat" and "lon" for spatial subsetting, and "time" for temporal, regardless of the names of those axes in the data files. Harmony also supports arbitrary dimension names for subsetting on numeric ranges for that dimension.
* `outputCrs`: reproject the output coverage to the given CRS. Recognizes CRS types that can be inferred by gdal, including EPSG codes, Proj4 strings, and OGC URLs (http://www.opengis.net/def/crs/...)

* `interpolation`: specify the interpolation method used during reprojection and scaling
* `scaleExtent`: scale the resulting coverage either among one axis to a given extent
* `scaleSize`: scale the resulting coverage either among one axis to a given size
* `concatenate`: requests results to be concatenated into a single result
* `granuleId`: the CMR Granule ID for the granule which should be retrieved
* `granuleName`: passed to the CMR search as the readable_granule_name parameter. Supports * and ? wildcards for multiple and single character matches. Wildcards can be used any place in the name, but leading wildcards are discouraged as they require a lot of resources for the underlying search
* `grid`: the name of the output grid to use for regridding requests. The name must match the UMM grid name in the CMR.
* `point`: only collections that have a geometry that contains a spatial point are selected. The spatial point is provided as two numbers:
  * Longitude, coordinate axis 1
  *  Latitude, coordinate axis 2

  The coordinate reference system of the values is [WGS84 longitude/latitude](http://www.opengis.net/def/crs/OGC/1.3/CRS84).
* `width`: number of columns to return in the output coverage
* `height`: number of rows to return in the output coverage
* `forceAsync`: if "true", override the default API behavior and always treat the request as asynchronous
* `format`: the output mime type to return
* `maxResults`: limits the number of input files processed in the request
* `skipPreview`: if "true", override the default API behavior and never auto-pause jobs
* `ignoreErrors`: if "true", continue processing a request to completion even if some items fail
* `destinationUrl`: destination url specified by the client, currently only s3 link urls are supported (e.g. s3://my-bucket-name/mypath) and will result in the job being run asynchronously

For `POST` requests the request body should be `multipart/form-data` and may also contain
* `shape`: perform a shapefile subsetting request on a supported collection by passing the path to a GeoJSON file (*.json or .geojson), an ESRI Shapefile (.zip or .shz), or a kml file (.kml) as the "shape" parameter

<br/>
<br/>