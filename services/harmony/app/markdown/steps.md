### <a name="jobs-steps"></a>  Inspecting a Job's Steps with the Steps API

The steps API provides introspection into the workflow steps that make up a job and the work items each step processed. It is useful for understanding how a request was broken down across services and for inspecting the inputs and outputs of each step.

As with the jobs API, there are two sets of steps API endpoints with the same sub paths and parameters: one with path `jobs` to view the current user's own jobs; the other with `admin/jobs` path to view all users' jobs if the current user has admin permission to do so. For simplicity, we will only list the ones for a regular user below.

#### Getting the steps for a job

```

{{root}}/jobs/<job-id>/steps

```
**Example {{exampleCounter}}** - Getting the steps for a job

Returns the workflow steps for the given job, along with the work items processed by each step. Each step's work items are paged independently: by default up to 50 are shown per step (configurable with `limit`), and each step is navigated with its own `step<stepIndex>Page` parameter. A step with more than one page of work items includes a `paging` object with links to the other pages.

##### <a name="steps-query-parameters"></a> Query Parameters
Parameter names are case-insensitive (e.g. `step2Page`, `Step2Page`, and `STEP2PAGE` are equivalent).

| parameter           | description                                                                                                                                                                                  |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| step                | Limit the response to one or more steps by stepIndex, comma-separated (e.g. `step=1,2`). Each a positive integer.                                                                             |
| status              | Filter the work items shown to one or more statuses, comma-separated (e.g. `status=failed,warning`). Each one of `ready`, `queued`, `running`, `successful`, `failed`, `canceled`, or `warning`. Steps with no matching work items are omitted. |
| workItem            | Limit the work items shown to one or more IDs, comma-separated (e.g. `workItem=123,124`). Each a positive integer.                                                                            |
| limit               | The number of work items to show per page for each step. Defaults to 50, maximum 1000.
| step\<stepIndex\>Page | The page of work items to show for the step with the given stepIndex, e.g. `step2Page=3`. A positive integer that defaults to 1; a page beyond the last page returns the last page. Each step pages independently, so multiple may be supplied. |

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
Each entry in a step's `workItems` list describes a single work item:

| field       | description                                                                                                                                                                               |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id          | ID of the work item in Harmony                                                                                                                                                            |
| status      | Status of the work item                                                                                                                                                                   |
| retryCount  | The number of times the work item has been retried                                                                                                                                        |
| inputFiles  | A list of links to the input files for the work item, or `null` if the work item has no STAC input (e.g. the first query-cmr step).                                                       |
| outputFiles | A list of links to the output files produced by the work item, or `null` if it produced no output. Files that cannot be turned into a public link are shown as `<private file location>`. |
| warning     | Warning message displayed if the outputFiles array is incomplete.                                                                                                                          |

---
**Table {{tableCounter}}** - Harmony work item fields

<br/>
<br/>
