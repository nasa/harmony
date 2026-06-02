### <a name="jobs-steps"></a>  Inspecting a Job's Steps with the Steps API

The steps API provides introspection into the workflow steps that make up a job and the work items each step processed. It is useful for understanding how a request was broken down across services and for inspecting the inputs and outputs of each step.

As with the jobs API, there are two sets of steps API endpoints with the same sub paths and parameters: one with path `jobs` to view the current user's own jobs; the other with `admin/jobs` path to view all users' jobs if the current user has admin permission to do so. For simplicity, we will only list the ones for a regular user below.

#### Getting the steps for a job

```

{{root}}/jobs/<job-id>/steps

```
**Example {{exampleCounter}}** - Getting the steps for a job

Returns the workflow steps for the given job, along with the work items processed by each step. By default, up to 50 work items are returned per step; steps with more work items than that include a `paging` note in the response.

##### <a name="steps-query-parameters"></a> Query Parameters
| parameter | description                                                                                                                                                                                  |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| step      | Limit the response to the step with this stepIndex (a positive integer).                                                                                                                     |
| status    | Filter the work items shown to those with this status. One of `ready`, `queued`, `running`, `successful`, `failed`, `canceled`, or `warning`. Steps with no matching work items are omitted. |
| workItem  | Limit the work items shown to the one with this ID (a positive integer).                                                                                                                     |

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
| paging        | Present only when the step has more work items than can be shown on a single page.                                                         |

---
**Table {{tableCounter}}** - Harmony step fields

###### <a name="step-work-item-response"></a> Work item fields
Each entry in a step's `workItems` list describes a single work item:

| field       | description                                                                                                                                                                               |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id          | ID of the work item in Harmony                                                                                                                                                            |
| status      | Status of the work item                                                                                                                                                                   |
| retryCount  | The number of times the work item has been retried                                                                                                                                        |
| inputFiles  | A list of links to the input files for the work item, or `null` if the work item has no STAC input (e.g. the first query-cmr step).                                                       |
| outputFiles | A list of links to the output files produced by the work item, or `null` if it produced no output. Files that cannot be turned into a public link are shown as `<private file location>`. |
| warning     | Warning message displayed if the outputFiles array is incomplete                                                                                                                          |

---
**Table {{tableCounter}}** - Harmony work item fields

<br/>
<br/>
