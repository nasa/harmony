## Monitoring Jobs with the Jobs API and the Workflow-UI

Jobs can be monitored using the `jobs` API as well as with the [Workflow-UI](/workflow-ui) web application.

##### Getting the list of jobs for a user

```

curl -Ln -bj {{root}}/jobs

```
**Example {{exampleCounter}}** - Getting the user's list of jobs using the `jobs` API

##### Getting job status

```

curl -Ln -bj {{root}}/jobs/<job-id>

```
**Example {{exampleCounter}}** - Getting job status

##### Pausing a job

```

curl -Ln -bj {{root}}/jobs/<job-id>/pause

```
**Example {{exampleCounter}}** - Pausing a running job

##### Resuming a paused job

```

curl -Ln -bj {{root}}/jobs/<job-id>/resume

```
**Example {{exampleCounter}}** - Resuming a paused job

##### Canceling a job

```

curl -Ln -bj {{root}}/jobs/<job-id>/cancel

```
**Example {{exampleCounter}}** - Canceling a running job

Jobs involving many granules will by default pause automatically after the first few
granules are processed. This allows the user to examine the output to make sure things
look right before waiting for the entire job to complete. If things looks good, the
user can resume the paused job, if not they can cancel the paused job.

If a user wishes to skip this step they can pass the `skipPreview` flag mentioned in the
[Services API section](#using-the-service-apis), or they can tell an already running job
to skip the preview using the following:

##### Skipping preview

```

curl -Ln -bj {{root}}/jobs/<job-id>/skip-preview

```
**Example {{exampleCounter}}** - Skipping the preview on a many-granule job

<br/>
<br/>
