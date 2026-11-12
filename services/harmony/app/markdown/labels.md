### <a name="job-labels"></a>  Labeling Jobs

Labels can be applied to a job when a Harmony request is made using the `label` parameter documented
in the [Services API section](#using-the-service-apis). After a request is made the labels can be viewed in the
job status page and in the workflow-ui.

Labels may contain commas. In a request query string, a literal comma separates labels, so `label=foo,bar`
applies the two labels `foo` and `bar`, while a URL-encoded comma (`%2C`) is part of a label, so
`label=foo&label=a%2Cb` applies the two labels `foo` and `a,b`. The request URL shown in the job status
lists each label as a separate `label` parameter, so resubmitting it applies the same labels.

Labels can be added to existing jobs by the job owner using an HTTP PUT request and specifying the job IDs and labels in the body of the PUT. An EDL bearer token must be provided and a `Content-Type: application/json` header. A `curl` example that adds two labels to two different jobs follows:

```
curl -bj {{root}}/labels -XPUT -d '{"jobID": ["<YOUR FIRST JOB ID>", "<YOUR SECOND JOB ID>"], "label": ["foo", "bar"]}'  -H "Content-Type: application/json" -H "Authorization: bearer <YOUR BEARER TOKEN>"
```

Similarly, labels can be removed from one or more jobs using an HTTP DELETE:

```
curl -bj {{root}}/labels   -XDELETE -d '{"jobID": ["<YOUR FIRST JOB ID>", "<YOUR SECOND JOB ID>"], "label": ["foo"]}'  -H "Content-Type: application/json" -H "Authorization: bearer <YOUR BEARER TOKEN>"
```

