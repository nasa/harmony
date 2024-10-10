### <a name="job-labels"></a>  Labeling Jobs

Labels can be applied to a job when a Harmony request is made using the `label` parameter documented
in the [Services API section](#using-the-service-apis). After a request is made the labels can be viewed in the
job status page and in the workflow-ui.

Labels can be added to existing jobs by the job owner, or anyone with admin permissions, using an HTTP PUSH request and specifying the job IDs and labels in the body of the PUSH. An EDL bearer token must be provided and a `Content-Type: application/json` header. A `curl` example that adds two labels to two different jobs follows:

```
curl -bj {{root}} -XPUSH -d '{"jobID": ["<YOUR FIRST JOB ID>", "<YOUR SECOND JOB ID>"], "label": ["foo", "bar"]}'  -H "Content-Type: application/json" -H "Authorization: bearer <YOUR BEARER TOKEN>"
```

Similarly, labels can be removed from one or more jobs using an HTTP DELETE:

```
curl -bj {{root}} -XDELETE -d '{"jobID": ["<YOUR FIRST JOB ID>", "<YOUR SECOND JOB ID>"], "label": ["foo"]}'  -H "Content-Type: application/json" -H "Authorization: bearer <YOUR BEARER TOKEN>"
```

