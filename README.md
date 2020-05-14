# Harmony

Services.  Together.

Harmony has two fundamental goals in life:
1. **Services** - Increase usage and ease of use of EOSDIS' data, especially focusing on opportunities made possible now that data from multiple DAACs reside in AWS.  Users should be able to work seamlessly across data from different DAACs in ways previously unachievable.
2. **Together** - Transform how we, as a development community, work together to accomplish goal number 1.  Let's reuse the simple, but necessary components (e.g. EDL, UMM, CMR and Metrics integration) and let's work together on the stuff that's hard (and fun) like chaining, scaling and cloud optimizations.

For general project information, visit the [Harmony wiki](https://wiki.earthdata.nasa.gov/display/Harmony). Harmony discussion and collaboration occurs in the EOSDIS #harmony Slack channel.

## Development Prerequisites

Required:
* A local copy of this repository.  Using `git clone` is strongly recommended
* Node.js version 12.  We recommend installing [NVM](https://github.com/nvm-sh/nvm) to add and manage node versions
* Mac OSX, Linux, or similar command line tooling.  Harmony is tested to run on OSX >= 10.14 and Amazon Linux 2.  Command-line instructions and bash helper files under [bin/](bin/) are tested on OSX >= 10.14.
* [git](https://git-scm.com) - Used to clone this repository
* A running [Docker Desktop](https://www.docker.com/products/developer-tools) or daemon instance - Used to invoke docker-based services
* The [AWS CLI](https://aws.amazon.com/cli/) - Used to interact with both localstack and real AWS accounts
* PostgreSQL (required by the pg-native library) - `brew install postgresql` on OSX
* Earthdata Login application

Highly Recommended:
* An Amazon Web Services account - Used for testing Harmony against object stores and running Harmony in AWS
* An editor with syntax awareness of modern Javascript.  If you do not have this or any preference, consider [Visual Studio Code](https://code.visualstudio.com)


Optional:
* [awscli-local](https://github.com/localstack/awscli-local) - CLI helpers for interacting with localstack
* [Python](https://www.python.org) version 3.7 - Useful for locally running and testing harmony-docker and other backend services

## Running Harmony

### Setup Environment
If you have not yet cloned the Harmony repository, run
```
$ git clone https://git.earthdata.nasa.gov/scm/harmony/harmony.git
```

Ensure node is available and is the correct version, 12.x.x

```
$ node --version
v12.15.0
```

If it is not the correct version and you are using NVM, install it and ensure your `PATH` is up-to-date by running:

```
$ nvm use && nvm install
```

Then verify the version again as above.

From the harmony project root, install library dependencies:
```
npm install
```

Recommended: Add `./node_modules/.bin` to your `PATH`.  This will allow you to run binaries from installed node modules.  If you choose not to do this, you will need to prefix node module calls with `npx`, e.g. `npx mocha` instead of just `mocha`

### Set up environment variables

Copy the file [example/dotenv](example/dotenv) to a file named `.env` in the root project directory.  Follow the instructions in that file to populate any blank variables.  Variables that have values in the example can be kept as-is, as they provide good defaults for local development.  To check environment differences between the example and local, run:

```
$ git diff --no-index .env example/dotenv
```

We recommend doing this any time you receive an example/dotenv update to ensure there are no new variables needed.

### Set up Earthdata Login application for your local Harmony instance
To use Earthdata Login with a locally running Harmomy, you must first set up a new application using the Earthdata Login UI.  https://wiki.earthdata.nasa.gov/display/EL/How+To+Register+An+Application.  You must select "401" as the application type for Harmony to work correctly with command line clients and clients like QGIS.  You will also need to add the "echo" group to the list of required application groups in order for CMR searches issued by Harmony to be able to use your Earthdata Login tokens.  Update your .env file with the information from your Earthdata Login application. Additional information including OAUTH values to use when creating the application can be found in the example/dotenv file in this repository.

### Start localstack
To avoid using real S3 buckets when testing locally, you can run [Localstack](https://github.com/localstack/localstack).  Our helper
script installs it, runs a local S3 instance, and creates the staging bucket configured in `.env`

```
$ bin/run-localstack
```

Keep this running during development.  `Ctrl-C` will exit.

### Run Tests

To run the linter, tests, and coverage checks as the CI environment will, run

```
$ npm test
```

Harmony uses [eslint](https://eslint.org) as a linter, which can be invoked as `$ npx eslint` (or `$ eslint` if you have set up your `PATH`).  It uses [mocha](https://mochajs.org) for tests, `$ npx mocha`, and [nyc](https://istanbul.js.org) for code coverage, `$ npx nyc mocha`.

#### Test Fixtures
Rather than repeatedly perform the same queries against the CMR, our test suite
uses [node-replay](https://github.com/assaf/node-replay) to record and play back
HTTP interactions.  All non-localhost interactions are recorded and placed in files
in the [fixtures directory](fixtures/).

By default, the test suite will playback interactions it has already seen and
record any new interactions to new files.  This behavior can be changed by setting
the `REPLAY` environment variable, as described in the
[node-replay README](https://github.com/assaf/node-replay).

To re-record everything, remove the fixtures directory and run the test suite. This should be done to cull the recordings when a code change makes many of them obsolete, when CMR adds response fields that Harmony needs to make use of, and periodically to ensure no impactful CMR changes or regressions.

### Setup the Database

To set a sqlite3 database with the correct schema for local execution, run

```
$ npx knex --cwd db migrate:latest
```

This should be run any time the versioned contents of the `db/migrations` directory change.

This will create a file, `db/development.sqlite3`, which will contain your local data.  You can delete the above file to remove
all existing development data.

In production environments, we use PostgreSQL.  If you have a PostgreSQL database, you can run create and/or migrate your
database by setting.
`NODE_ENV=production` and `DATABASE_URL=postgresql://your-postgres-connection-url`.

### Run Harmony

To run Harmony locally such that it reloads when files change (recommended during development), run

```
$ npm run start-dev
```

In production, we use `$ npm run start` which does the same but does not add the file watching and reloading behavior.

You should see messages about the two applications listening on two ports, "frontend" and "backend."  The frontend application receives requests from users, while the backend application receives callbacks from services.

The application is not very useful at this point, since no backends have been configured, which is the next step. For now,`Ctrl-C` to exit Harmony.

### Add a backend

Clone the Harmony GDAL service repository into a peer directory of the main Harmony repo
```
$ cd ..
$ git clone https://git.earthdata.nasa.gov/scm/harmony/harmony-gdal.git
```

From the harmony-gdal project root, run
```
$ bin/build-image
```

This may take some time, but ultimately it will produce a local docker image tagged `harmony/gdal:latest`.  You may choose to use another service appropriate to your collection if you have [adapted it to run in Harmony](docs/adapting-new-services.md).

### Connect a client

From the main Harmony repository directory, once again run

```
$ npm run start-dev
```

You should now be able to view the outputs of performing a simple transformation request.  Harmony has its own test collection
set up for sanity checking harmony with the harmony-gdal backend.  This will fetch a granule from that collection converted to GeoTIFF:
[http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/all/coverage/rangeset?granuleId=G1233800343-EEDTEST](http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/all/coverage/rangeset?granuleId=G1233800343-EEDTEST)

You can also set up a WMS connection in [QGIS](https://qgis.org/en/site/about/index.html), for example, by placing the
`http://localhost:3000/C1233800302-EEDTEST/wms` as the "URL" field input in the "Connection Details"
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

#### Stop here and set up CI/CD

Deploying the code should be done using the harmony-ci-cd project from Bamboo rather than manually.  Apart from that project and CI/CD setup,
we do not yet have automation scripts for (re)deploying to AWS manually, as it is typically not needed during development.

#### Deploy the code to AWS

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
  $ CALLBACK_HOST=$instance_ip \
    STAGING_PATH=s3://$STAGING_BUCKET \
    GDAL_IMAGE=$GDAL_IMAGE \
    PO_L2_IMAGE=$PO_L2_IMAGE \
    STAGING_BUCKET=$STAGING_BUCKET \
    OAUTH_HOST=$OAUTH_HOST \
    OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID \
    OAUTH_PASSWORD=$OAUTH_PASSWORD \
    OAUTH_REDIRECT_URI=$OAUTH_REDIRECT_URI \
    COOKIE_SECRET=$COOKIE_SECRET \
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
