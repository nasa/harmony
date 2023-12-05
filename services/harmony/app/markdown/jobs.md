### <a name="jobs-details"></a>  Monitoring Jobs with the Jobs API and the Workflow-UI

Jobs can be monitored using the jobs API as well as with the [Workflow-UI](/workflow-ui) web application.

There are two set of jobs API endpoints with the same sub paths and parameters: one with path `jobs` to view and control the current user's own jobs; the other with `admin/jobs` path to view and control all users' jobs if the current user has admin permission to do so. For simplicity, we will only list the ones for regular user below.

#### Getting the list of jobs for a user

```

{{root}}/jobs

```
**Example {{exampleCounter}}** - Getting the user's list of jobs using the `jobs` API

Returns the list of Harmony jobs submitted by the user. By default, 10 jobs are returned in the response. User can use the paging query parameters to page through the whole result set or/and change the number of jobs that will be returned in each page.

##### <a name="query-parameters"></a> Query Parameters
| parameter | description                 |
|-----------|-----------------------------|
| page      | Current page number         |
| limit     | Number of jobs in each page |
---
**Table {{tableCounter}}** - Harmony jobs endpoint parameters

##### <a name="jobs-response"></a> Response
The returned JSON response will list the total number of jobs that blong to the user, details of the jobs on the current page and links to traverse to the previous, next, first or last pages of the result set:

| field | description                                                                                                            |
|-------|------------------------------------------------------------------------------------------------------------------------|
| count | Total number of jobs                                                                                                   |
| jobs  | A list of JSON objects with fields describe the job in details. For details, see [job status response](#job-response). |
| links | A list of links to traverse to the previous, next, first or last pages of the result set.                              |
---
**Table {{tableCounter}}** - Harmony jobs response fields

#### Getting job status

Get details for a given job.

```

{{root}}/jobs/<job-id>

```
**Example {{exampleCounter}}** - Getting job status

##### <a name="job-response"></a> Response
The returned JSON response list the details of the given job:

| field            | description                                                                                    |
|------------------|------------------------------------------------------------------------------------------------|
| username         | Username that owns the job                                                                     |
| status           | Status of the job                                                                              |
| message          | Processing message of the job                                                                  |
| progress         | Percentage of the job processing progress. `100` for a job that has been processed completely. |
| createdAt        | Timestamp when the job was submitted to Harmony                                                |
| updatedAt        | Timestamp when the job was last updated in Harmony                                             |
| dataExpiration   | Timestamp when the result data of the job will be cleaned up from Harmony                      |
| links            | A list of JSON objects with links to STAC catalog and result data of the job                   |
| request          | The original request url of the job                                                            |
| numInputGranules | number of input granules in the job                                                            |
| jobID            | ID of the job in Harmony                                                                       |
---
**Table {{tableCounter}}** - Harmony job response fields


#### Pausing a job

User can pause a job with the following API call. The returned response is the same as the [job status response](#job-response) with the job status as `paused`.

```

{{root}}/jobs/<job-id>/pause

```
**Example {{exampleCounter}}** - Pausing a running job


#### Resuming a paused job

User can resume a paused job with the following API call. The returned response is the same as the [job status response](#job-response) with the job status as `running`.

```

{{root}}/jobs/<job-id>/resume

```
**Example {{exampleCounter}}** - Resuming a paused job


#### Canceling a job

User can cancel a job with the following API call. The returned response is the same as the [job status response](#job-response) with the job status as `canceled`.

```

{{root}}/jobs/<job-id>/cancel

```
**Example {{exampleCounter}}** - Canceling a running job


#### Skipping preview

Jobs involving many granules will by default pause automatically after the first few
granules are processed. This allows the user to examine the output to make sure things
look right before waiting for the entire job to complete. If things looks good, the
user can resume the paused job, if not they can cancel the paused job.

If a user wishes to skip this step they can pass the `skipPreview` flag mentioned in the
[Services API section](#using-the-service-apis), or they can tell an already running job
to skip the preview using the following:

```

{{root}}/jobs/<job-id>/skip-preview

```
**Example {{exampleCounter}}** - Skipping the preview on a many-granule job

<br/>
<br/>
