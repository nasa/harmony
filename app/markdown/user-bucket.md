## User Owned Buckets for Harmony Output
Users may store Harmony output directly in their own S3 buckets by specifying the bucket/path
in their requests with the `destinationUrl` parameter. For example

```

{{root}}/C1234088182-EEDTEST/ogc-api-coverages/1.0.0/collections/blue_var/coverage/rangeset?format=image%2Fpng&maxResults=1&granuleID=G1256340898-EEDTEST&destinationUrl=s3%3A%3A%2F%2Fmy-example-bucket

```
**Example {{exampleCounter}}** - Request to store output in user owned S3 bucket

would place the output in `s3://my-example-bucket`. Note that ==the value of `destinationUrl` must be a full S3 path and
must be URL encoded.==

Four things are required to enable Harmony to write to your bucket.

1. The bucket must be in the same AWS region as Harmony, i.e., `us-west-2`.
2. The bucket must have ACLs disabled. This is the default for S3 buckets.
3. Harmony must have permission to write to the bucket.
4. Harmony must have permission to check the bucket's location.

Numbers two through four on the list can be accomplished by setting an appropriate bucket policy.
You can obtain a bucket policy for your bucket using the policy generator at
{{root}}/staging-bucket-policy and passing in the `bucketPath` query parameter. For example

[{{root}}/staging-bucket-policy?bucketPath=my-example-bucket]({{root}}/staging-bucket-policy?bucketPath=my-example-bucket)


The `bucketPath` parameter can be one of the following
1. A bucket name, e.g., `my-example-bucket`
2. A bucket name + path, e.g., `my-example-bucket/my/path`
3. A full S3 url with our without a path, e.g., `s3://my-example-bucket/my/path`

The third option is compatible with the `destinationUrl` parameter for requests.


```json

{
  'Version': '2012-10-17',
  'Statement': [
    {
      'Sid': 'write permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:PutObject',
      'Resource': 'arn:aws:s3:::my-bucket/*',
    },
    {
      'Sid': 'get bucket location permission',
      'Effect': 'Allow',
      'Principal': {
        'AWS': 'arn:aws:iam::123456789012:root',
      },
      'Action': 's3:GetBucketLocation',
      'Resource': 'arn:aws:s3:::my-bucket',
    },
  ]
}

```
**Example {{exampleCounter}}** - Sample bucket policy to enable writing Harmony output

<br/>
<br/>
