# Harmony

Services.  Together.

Harmony has two fundamental goals in life:
1. **Services** - Increase usage and ease of use of EOSDIS' data, especially focusing on opportunities made possible now that data from multiple DAACs reside in AWS.  Users should be able to work seamlessly across data from different DAACs in ways previously unachievable.
2. **Together** - Transform how we, as a development community, work together to accomplish goal number 1.  Let's reuse the simple, but necessary components (e.g. EDL, UMM, CMR and Metrics integration) and let's work together on the stuff that's hard (and fun) like chaining, scaling and cloud optimizations.

For general project information, visit the [Harmony wiki](https://wiki.earthdata.nasa.gov/display/Harmony). Harmony discussion and collaboration occurs in the EOSDIS #harmony Slack channel.

## Development Prerequisites

Required:
* A local copy of this repository.  Using `git clone` is strongly recommended
* Node.js version 10.  We recommend installing [NVM](https://github.com/nvm-sh/nvm) to add and manage node versions
* Mac OSX, Linux, or similar command line tooling.  Harmony is tested to run on OSX >= 10.14, Amazon Linux 2, and Alpine Linux.  Command-line instructions and bash helper files under [bin/](bin/) are tested on OSX >= 10.14.

Highly Recommended:
* [git](https://git-scm.com) - Used to clone this repository
* A running [Docker Desktop](https://www.docker.com) or daemon instance - Used to invoke docker-based services
* An Amazon Web Services account - Used for testing Harmony against object stores and running Harmony in AWS
* A running [Localstack](https://github.com/localstack/localstack) instance - Used for testing AWS services locally.  Only the S3 service needs to run.
* The [AWS CLI](https://aws.amazon.com/cli/) - Used to interact with both localstack and real AWS accounts
* An editor with syntax awareness of modern Javascript.  If you do not have this or any preference, consider [Visual Studio Code](https://code.visualstudio.com)

Optional:
* [awscli-local](https://github.com/localstack/awscli-local) - CLI helpers for interacting with localstack
* [Python](https://www.python.org) version 3.7 - Useful for locally running and testing harmony-docker and other backend services

## Running Harmony

### Setup Environment

Ensure node is available and is the correct version, 10.x.x

```
$ node --version
v10.16.1
```

If it is not the correct version and you are using NVM, install it and ensure your `PATH` is up-to-date by running:

```
$ nvm use && nvm install
```

Then verify the version again as above.

Install library dependencies:
```
npm install
```

Recommended: Add `./node_modules/.bin` to your `PATH`.  This will allow you to run binaries from installed node modules.  If you choose not to do this, you will need to prefix node module calls with `npx`, e.g. `npx mocha` instead of just `mocha`

### Run Tests

To run the linter, tests, and coverage checks as the CI environment will, run

```
$ npm test
```

Harmony uses [eslint](https://eslint.org) as a linter, which can be invoked as `$ npx eslint` (or `$ eslint` if you have set up your `PATH`).  It uses [mocha](https://mochajs.org) for tests, `$ npx mocha`, and [nyc](https://istanbul.js.org) for code coverage, `$ npx nyc mocha`.

#### Test Fixtures
Rather than repeatedly perform the same queries against the CMR, our test suite
uses [replayer](https://github.com/aneilbaboo/replayer) to record and play back
HTTP interactions.  All non-localhost interactions are recorded and placed in files
in the [fixtures directory](fixtures/).

By default, the test suite will playback interactions it has already seen and
record any new interactions to new files.  This behavior can be changed by setting
the `VCR_MODE` environment variable, as described in the
[replayer documentation](https://github.com/aneilbaboo/replayer).

To re-record everything, remove the fixtures directory and run the test suite.
This should be done to cull the recordings when a code change makes many of them
obsolete, when CMR adds response fields that Harmony needs to make use of, and
periodically to ensure no impactful CMR changes or regressions.

### Run Harmony

To run Harmony locally such that it reloads when files change (recommended during development), run

```
$ npm run start-dev
```

In production, we use `$ npm run start` which does the same but does not add the file watching and reloading behavior.

You should see messages about the two applications listening on two ports, "frontend" and "backend."  The frontend
application receives requests from users, while the backend application receives callbacks from services.

The application is not very useful at this point, since no backends have been configured, which is the next step. For now,
`Ctrl-C` to exit Harmony.

### Add a backend

Clone the [Harmony GDAL service repository](https://git.earthdata.nasa.gov/projects/HARMONY/repos/harmony-gdal/browse) on your machine.

From the harmony-gdal project root, run
```
$ bin/build-image
```

This may take some time, but ultimately it will produce a local docker image tagged `harmony/gdal:latest`.  You may choose to use
another service appropriate to your collection if you have [adapted it to run in Harmony](docs/adapting-new-services.md).

### Set up environment variables

Copy the file [example/dotenv](example/dotenv) to a file named `.env` in the root project directory.  Follow the instructions
in that file to populate any blank variables.  Variables that have values in the example can be kept as-is, as they provide
good defaults for local development.  To check environment differences between the example and local, run:

```
$ git diff --no-index .env example/dotenv
```

We recommend doing this any time you receive an example/dotenv update to ensure there are no new variables needed.

### Stage some data

If you have a CMR collection with granules that are in S3, using it is ideal.  If not, you can run service requests against any
collection whose granule URLs only require Earthdata Login authentication, but this will end up pulling the data which is slow
and adds a production burden to the data provider.  For faster local testing, we can stage example data locally, either in S3 or
on the local disk.

To do so, fetch the desired files, whose filenames should match the part after the final `/` in their respective URLs.  The files
chosen should correspond to the ones that would be fetched by the service calls to be performed.  For this reason, it is much simpler
to choose collections that have global spatial coverage.  Place the files in the desired staging path, which can be S3, a localstack
S3 location, or a directory in the backend service's Docker image (e.g. `harmony-gdal/staged-data`).

If data is staged in a directory in the backend service's Docker image, you will need to rebuild that image to include the files. If using
harmony-gdal, this means running `$ bin/build-image` from the root of the service's directory.

Once the files are in place, set the `STAGING_PATH` environment variable to point at the prefix up to and including the final `/`
before the filename, e.g.

```
STAGING_PATH=staged-data/
```
or
```
STAGING_PATH=s3://some-staging-bucket/staged-data/
```

In order to use this every time, you can add one of the above lines to a file named `.env` in the harmony project's root directory.

After doing this step and restarting the server, all subsequent CMR calls that find data URLs with prefix `http` will have their URLs
converted to use the staging path instead.  Data that is already in S3 will be fetched from its S3 location.

For testing, stage the first few granules of the `C1215669046-GES_DISC` collection from CMR UAT, which has UMM-Var variables and is
configured to use the gdal service.  The following will produce a list of URLs to download, provided you have the [jq](https://stedolan.github.io/jq/)
utility installed:

```
$ curl 'https://cmr.uat.earthdata.nasa.gov/search/granules.json?pretty=true&collection_concept_id=C1215669046-GES_DISC&page_size=3' \
  | jq -r '.feed.entry[].links[].href | select(endswith(".hdf") and contains("/data/"))'
```

You will need to use Earthdata login to actually fetch the URLs, which is most easily done through a web browser.

### Connect a client

Once again, run

```
$ npm run start-dev
```

You should now be able to view the outputs of the WMS service by pointing a client at the WMS URL for a test collection.  For
the GESDISC collection with staged data above, the corresponding URL is `http://localhost:3000/C1215669046-GES_DISC/wms`.

This can be set up as a WMS connection in [QGIS](https://qgis.org/en/site/about/index.html), for example, by placing the above URL as the "URL" field input in the "Connection Details"
dialog when adding a new WMS connection.  Thereafter, expanding the connection should provide a list of layers obtained through a
GetCapabilities call to the test server, and double-clicking a layer should add it to a map, making a WMS call to retrieve an appropriate
PNG from the test server.

### Setting up to run in AWS

Note: It is currently easiest to allow the CI/CD service to deploy the service remotely; it is deployed to the sandbox after each merge to `master`.
As the deployment simply uploads the code, sets environment variables, kills the old server and runs `$ npm run start`, at present, there is not
typically much to be gained by running remotely during development.

When setting up a new environment, the first two steps need to be performed, but the CI environment should be set up to run the deployment rather than having
it done manually.

#### Prerequisites
* Once per account, run `$ bin/account-setup` to create a service linked role for ECS.
* Upload the harmony/gdal Docker image somewhere accessible to an EC2 deployment.  This should be done any time the image changes.  The easiest way is to create an ECR in your account and push the image there.  Running `$ bin/build-image && bin/push-image` from the harmony-gdal repository will perform this step..

#### Provision an instance

Provisioning a new instance involves creating a CloudFormation stack from [deployment/ec2-template.yml](deployment/ec2-template.yml).

```
aws cloudformation deploy \
  --template-file deployment/ec2-template.yml \
  --stack-name $stack \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=$VPC_ID \
    Subnet1Id=$SUBNET_1_ID \
    Subnet2Id=$SUBNET_2_ID \
    PermissionsBoundaryArn=$PERMISSIONS_BOUNDARY_ARN \
    GdalImage=$GDAL_IMAGE \
    AMI=$AMI \
    CodePath=$CODE_PATH \
    SSHKeyName=$SSH_KEY_NAME \
    SSMTestRole=$SSM_TEST_ROLE
```

For information on what to pass for each parameter, see [deployment/ec2-template.yml](deployment/ec2-template.yml).

#### Stop here and set up CI/CD

Deploying the code should be done using the harmony-ci-cd project from Bamboo rather than manually.  Apart from that project and CI/CD setup,
we do not yet have automation scripts for (re)deploying to AWS manually, as it is typically not needed during development.

#### Deploy the code

Note: The harmony-ci-cd repository contains automation code to do the following, usable from Bamboo.  You may use it locally by setting all
relevant environment variables in a `.env` file, running `$ bin/build-image` in the root directory of the harmony-ci-cd project, and then
running the **harmony-ci-cd** `bin/deploy` script from your **harmony** codebase's root directory.

1. `scp` the Harmony codebase to the remote instance
2. `ssh` into the remote instance
3. Run `$ $(aws ecr get-login --region=$GDAL_REGION --no-include-email)` where `GDAL_REGION` is the region containing your harmony-gdal ECR instance.
Skip this step if harmony-gdal is not in an ECR.
4. Run `$ if pgrep node; then pkill node; fi` to stop any existing server that may be running
5. Run the following, where `$instance_ip` is the private IP address of your local instance and all other variables are as in prior steps:
```
  $ callback_host=$instance_ip \
    staging_path=s3://$STAGING_BUCKET \
    GDAL_IMAGE=$GDAL_IMAGE
    STAGING_BUCKET=$STAGING_BUCKET \
    EDL_USERNAME=$EDL_USERNAME \
    EDL_PASSWORD="$EDL_PASSWORD" \
    nohup npm start >> ../server.log 2>&1 &
```
6. Run `$ docker pull $GDAL_IMAGE` to fetch harmony-gdal changes, where `GDAL_IMAGE` is the EC2-accessible location of your harmony-gdal Docker image.

### Connecting a client to an AWS instance

This process is identical to "Connect a client" above, except instead of `http://localhost:3000`, the protocol and host should be that of your
load balancer, e.g. `https://your-load-balancer-name.us-west-2.elb.amazonaws.com`.  Retrieve the precise load balancer details from the
AWS console.

## Additional Resources

* [Adapting new services to Harmony](docs/adapting-new-services.md)
* [Harmony message schemas](app/schemas/data-operation)
* [EOSS protocol OpenAPI Specification](app/schemas/eoss)
* [Harmony GDAL service repository](https://git.earthdata.nasa.gov/projects/HARMONY/repos/harmony-gdal/browse)