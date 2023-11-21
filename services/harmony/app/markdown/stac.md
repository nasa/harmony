### <a name="stac-details"></a> Retrieving STAC catalog and catalog items for processed data

Harmony uses [STAC catalog](https://stacspec.org/en) to provide input and output, and communicate between services. The following endpoints provides access to the output STAC catalog and catalog items of a finished job.

#### Getting the STAC catalog of a single job

```

{{root}}/stac/<job-id>

```
**Example {{exampleCounter}}** - Getting the STAC catalog of a single job

#### Getting the STAC catalog item within a job's STAC catalog

The `<item-index>` is the index of the STAC catalog item within the job's output STAC catalog. It starts at 0.

```

{{root}}/stac/<job-id>/<item-index>

```
**Example {{exampleCounter}}** - Getting the STAC catalog item within a job's STAC catalog
