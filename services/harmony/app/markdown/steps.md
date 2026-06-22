### <a name="jobs-steps"></a>  Inspecting a Job's Steps with the Steps API

The steps API provides introspection into the workflow steps that make up a job and the work items each step processed. It is useful for understanding how a request was broken down across services and for inspecting the inputs and outputs of each step.

As with the jobs API, there are two sets of steps API endpoints with the same sub paths and parameters: one with path `jobs` to view the current user's own jobs; the other with `admin/jobs` path to view all users' jobs if the current user has admin permission to do so. For simplicity, we will only list the ones for a regular user below.

#### Getting the steps for a job

```http

{{root}}/jobs/<job-id>/steps

```
**Example {{exampleCounter}}** - Getting the steps for a job

Returns the workflow steps for the given job, along with the work items processed by each step. Each step's work items are paged independently: by default up to 50 are shown per step (configurable with `limit`), and each step is navigated with its own `step<stepIndex>Page` parameter. A step with more than one page of work items includes a `paging` object with links to the other pages.

A work item can reference or produce a very large number of files - for example a query-cmr step that fans out to thousands of granules, or an aggregating step whose single input catalog lists many items. To keep the endpoint responsive, it does **not** read any files from storage. Instead, each work item has `inputFilesUrl` and `outputFilesUrl` links (see [work item fields](#step-work-item-response)). The files themselves are resolved, and paged, only on demand by following those links - see [Resolving a work item's files](#steps-resolve-files).

#### <a name="steps-resolve-files"></a> Resolving a work item's files

To see a work item's actual input or output files, you need to follow its `inputFilesUrl` / `outputFilesUrl`, which is designed to make a request back to the steps endpoint scoped to that one work item and sets the `resolveFiles` parameter to the chosen input or output value:

```http

{{root}}/jobs/<job-id>/steps?workItem=<id>&resolveFiles=output

```
**Example {{exampleCounter}}** - Resolving a work item's output files

When `resolveFiles` is supplied and exactly one `workItem` is given, the work item is returned with the requested kind of files resolved inline:

- `resolveFiles=input` populates `inputFiles` (and `inputFilesPaging`), reading a page of the work item's input STAC catalog items.
- `resolveFiles=output` populates `outputFiles` (and `outputFilesPaging`), reading a page of the work item's output STAC catalogs.

Both are paged to bound the number of reads: at most `wiLimit` items/catalogs (default 50, maximum 100) are read per request. Input pages are navigated with the work item's `workItem<id>InputPage` parameter and output pages with its `workItem<id>OutputPage` parameter. A kind with more than one page includes an `inputFilesPaging` / `outputFilesPaging` object with links to the other pages.

##### <a name="steps-query-parameters"></a> Query Parameters
Parameter names are case-insensitive (e.g. `step2Page`, `Step2Page`, and `STEP2PAGE` are equivalent).

| parameter           | description                                                                                                                                                                                  |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| step                | Limit the response to one or more steps by stepIndex, comma-separated (e.g. `step=1,2`). Each a positive integer.                                                                             |
| status              | Filter the work items shown to one or more statuses, comma-separated (e.g. `status=failed,warning`). Each one of `ready`, `queued`, `running`, `successful`, `failed`, `canceled`, or `warning`. Steps with no matching work items are omitted. |
| workItem            | Limit the work items shown to one or more IDs, comma-separated (e.g. `workItem=123,124`). Each a positive integer.                                                                            |
| limit               | The number of work items to show per page for each step. Defaults to 50, maximum 1000.
| resolveFiles        | Resolves work item's files inline instead of returning `inputFilesUrl` / `outputFilesUrl` links. One of `input` or `output`. Requires exactly one `workItem`; otherwise the request is rejected. See [Resolving a work item's files](#steps-resolve-files). |
| wiLimit             | The page size used when resolving files: the number of input STAC items (for `resolveFiles=input`) or output STAC catalogs (for `resolveFiles=output`) read per page. Defaults to 50, maximum 100. |
| step\<stepIndex\>Page | The page of work items to show for the step with the given stepIndex, e.g. `step2Page=3`. A positive integer that defaults to 1; a page beyond the last page returns the last page. Each step pages independently, so multiple may be supplied. |
| workItem\<id\>OutputPage | The page of output files to show for the work item with the given id when `resolveFiles=output`, e.g. `workItem123OutputPage=2`. Output files are paged by STAC catalog (`wiLimit` per page). A positive integer that defaults to 1; a page beyond the last page returns the last page. |
| workItem\<id\>InputPage | The page of input files to show for the work item with the given id when `resolveFiles=input`, e.g. `workItem123InputPage=2`. Input files are paged by STAC item (`wiLimit` per page). A positive integer that defaults to 1; a page beyond the last page returns the last page. |

---
**Table {{tableCounter}}** - Harmony steps endpoint parameters

##### <a name="steps-response"></a> Response
The returned JSON response describes the job and the list of its steps:

| field            | description                                                                                           |
|------------------|-------------------------------------------------------------------------------------------------------|
| jobID            | ID of the job in Harmony                                                                              |
| serviceName      | Name of the service that ran the job                                                                  |
| status           | Status of the job                                                                                     |
| progress         | Percentage of the job processing progress. `100` for a job that has been processed completely.        |
| message          | Processing message of the job                                                                         |
| username         | Username that owns the job                                                                            |
| numInputGranules | Number of input granules in the job                                                                   |
| request          | The original request url of the job                                                                   |
| steps            | A list of JSON objects describing the workflow steps. For details, see [step fields](#step-response). |

---
**Table {{tableCounter}}** - Harmony steps response fields

###### <a name="step-response"></a> Step fields
Each entry in the `steps` list describes a single workflow step -- one service in a service chain:

| field         | description                                                                                                                                |
|---------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| serviceID     | The service image name and tag service that ran this step                                                                                  |
| stepIndex     | The position of this step in the workflow, starting at `1`                                                                                 |
| workItemCount | The total number of work items in this step                                                                                                |
| statuses      | A map of work item status to the number of work items in that status for the whole step. Only statuses with at least one work item appear. |
| workItems     | A list of JSON objects describing the work items for this step. For details, see [work item fields](#step-work-item-response).             |
| paging        | Present when the step has more than one page of work items. For details, see [paging fields](#step-paging-response). |

---
**Table {{tableCounter}}** - Harmony step fields

###### <a name="step-paging-response"></a> Paging fields
The `paging` object lets you navigate a step's work items one page at a time:

| field       | description                                                                                                                                                                                                |
|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| currentPage | The page of work items currently shown for this step.                                                                                                                                                     |
| lastPage    | The index of the last available page.                                                                                                                                                                     |
| total       | The total number of work items for this step, after any `status` or `workItem` filter.                                                                                                                    |
| links       | Navigation links, each with `rel` (one of `first`, `prev`, `self`, `next`, `last`), `href`, `title`, and `type`. Links that do not apply (e.g. `next` on the last page) are omitted.                       |

---
**Table {{tableCounter}}** - Harmony step paging fields

###### <a name="step-work-item-response"></a> Work item fields
Each entry in a step's `workItems` list describes a single work item. The default (link-only) response carries `id`, `status`, `retryCount`, and the two `*Url` fields. The `inputFiles` / `outputFiles` fields and their paging appear only when [resolving a work item's files](#steps-resolve-files):

| field       | description                                                                                                                                                                               |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id          | ID of the work item in Harmony                                                                                                                                                            |
| status      | Status of the work item                                                                                                                                                                   |
| retryCount  | The number of times the work item has been retried                                                                                                                                        |
| inputFilesUrl  | A link that resolves this work item's input files. Follow it (equivalently, pass `workItem=<id>&resolveFiles=input`) to get the files. |
| outputFilesUrl | A link that resolves this work item's output files, or `null` if the work item has not yet completed. Follow it (equivalently, pass `workItem=<id>&resolveFiles=output`) to get the files. |
| inputFiles  | A list of links to the input files for the current input-file page. Files unable be turned into a public link are shown as `<private file location>`. |
| inputFilesPaging | Present when needed. Navigate the pages with the `workItem<id>InputPage` parameter. Same shape as a step's `paging` object — see [paging fields](#step-paging-response) (here `total` is the work item's number of input STAC items). |
| outputFiles | A list of links to the output files for the current output-file page, or empty if it produced no output. Files unable be turned into a public link are shown as `<private file location>`. |
| outputFilesPaging | Present when needed. Navigate the pages with the `workItem<id>OutputPage` parameter. Same shape as a step's `paging` object — see [paging fields](#step-paging-response) (here `total` is the work item's number of output STAC catalogs). |

---
**Table {{tableCounter}}** - Harmony work item fields

<br/>
<br/>
