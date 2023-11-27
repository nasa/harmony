### <a name="cloud-access-details"></a> Getting in region S3 AWS access keys using the cloud-access API

Harmony supports analysis in place without forcing a user to download the outputs from their requests. The results for each harmony request are stored an AWS S3 bucket in the us-west-2 region. In order to access these results natively in S3 the user can get temporary AWS access credentials using the harmony cloud-access endpoints. Note that data can only be accessed from within the us-west-2 region.

#### Get AWS S3 access credentials as JSON

```

{{root}}/cloud-access

```
**Example {{exampleCounter}}** - Getting AWS S3 access credentials as JSON using the `cloud-access` API

The returned JSON response returns fields required to set the AWS S3 access credentials:

| field | description                                                   |
|-------|---------------------------------------------------------------|
| AccessKeyId | The AWS access key ID.                                  |
| SecretAccessKey  | The AWS secret access key.                         |
| SessionToken | The AWS session token associated with the access keys. |
| Expiration | The date and time when the access credentials expire.    |
---
**Table {{tableCounter}}** - Harmony cloud-access response fields

#### Get AWS S3 access credentials as a shell script to use in a terminal

```

{{root}}/cloud-access.sh

```
**Example {{exampleCounter}}** - Getting a shell script that can be sourced to set AWS S3 credentials

