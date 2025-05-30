## [0.22.0] - 2025-05-29
### Added
- DataSource.visualizations - The UMM-Vis records associated with the collection
- Variable.visualizations - The UMM-Vis records associated with a variable

## [0.21.0] - 2025-02-18
### Added
- pixelSubset - true/false - true if pixel subset should be performed by the service.

## [0.20.0] - 2024-10-10
### Added
- average - The averaging method to use. Initially Giovanni plans to support 'time' or 'area' averaging.

## [0.19.0] - 2024-04-10
### Added
- extraArgs - The extra arguments that will be passed to service worker

## [0.18.0] - 2023-08-28
### Added
- extendDimensions - The dimensions to extend (added initially for TEMPO users)

## [0.17.0] - 2022-07-12
### Added
- sources.shortName - The CMR short name for a source
- sources.versionId - The CMR version id for a source

## [0.16.0] - 2022-05-12
### Added
- subset.dimensions - An array containing the dimensions by which to subset. Each dimension contains a name and optionally a min and max value

## [0.15.0] - 2022-05-02
### Added
- sources.coordinateVariables - Array of coordinate variables for the given source collection
- variable.type - The value of the UMM-Var VariableType field.
- variable.subtype - The value of the UMM-Var VariableSubType field.

## [0.14.0] - 2022-02-19
### Added
- DataOperation.subset.point - Spatial point provided by the CMR

## [0.13.0] - 2021-02-04
### Added
- concatenate - true/false - true if the service should concatenate multiple input files into a single output file

## [0.12.0] - 2021-11-23
### Added
- variable.relatedUrls - Related URLs for a variable as provided by CMR.

## [0.11.0] - UNMERGED
### Changed
- DataOperation.sources[].granules are now optional

## [0.10.0] - UNMERGED
### Added
- DataOperation.srs - An object with keys 'proj4', 'wkt', and 'epsg'. 'epsg' may be an empty string if unknown.

## [0.9.0] - UNMERGED
### Added
- DataOperation.accessToken - The EarthData Login token of the user who is making the request.

## [0.8.0] -2020-05-11
### Added
- variable.fullPath - The variable's absolute path within the file, including hierarchy.  Derived from UMM-Var group path combined with name.

## [0.7.0] -2020-04-07
### Added
- granule.bbox - Bounding box provided by the CMR
- granule.temporal - Temporal object for Granule start and stop times as provided by the CMR

## [0.6.0] - 2020-03-27
### Added
- subset.shape - Reference to a location containing a shape within which the service should spatially subset.
  If present, the resource will always be GeoJSON (application/geo+json) in an object store (S3)
- stagingLocation - A URL prefix to a staging location where services place their results

## [0.5.0] - 2020-03-03
### Changed
- format - Added a few additional subfields to support regridding. New subfields are interpolation, scaleExtent, and scaleSize.
  - interpolation - A string specifying the interpolation method.
  - scaleExtent - An object with x and y properties that are both objects with fields min and max. scaleExtent.x.min, scaleExtent.x.max, scaleExtent.y.min, and scaleExtent.y.max specify the scaling extent for the scaling operation.
  - scaleSize - An object with x and y properties that are both numbers specifying the scaling in the x and y dimensions to use for the scaling operation.

## [0.4.0] - 2020-02-18
### Added
- temporal - Object with two ISO 8601 date time fields: start and end. Used to indicate temporal subsetting to be performend between the start and end times. If only a start or only an end are provided the range should be considered unbounded for the start or end respectively.

## [0.3.0] - 2020-02-05
### Added
- isSynchronous - Synchronous request mode - True if the request is going to be returned synchronously back to the end user. Note a backend service can still use a callback URL to indicate completion.
- requestId - UUID to uniquely identify a request. Should be used in all logging messages.

## [0.2.0] - 2019-12-03
### Added
- client - A string identifier indicating the client submitting the request

## [0.1.0] - 2019-10-11
### Added
- Initial verision
