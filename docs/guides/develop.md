# Run and Develop Harmony

Use this guide if you plan on contributing (developing/testing/debugging) Harmony code, or if you need a setup that isn't well suited to the [Quick Start](../../README.md#quick-start-mac-os-x--linux).

For developing Harmony on _**Windows**_ follow this document as well as the information in [docs/dev_container/README.md](../dev_container/README.md).

 ## Software Requirements

Required:
* A local copy of this repository.  Using `git clone` is strongly recommended
* Node.js version 22.  We strongly recommend installing [NVM](https://github.com/nvm-sh/nvm) to add and manage node versions.
* Mac OSX, Linux, or similar command line tooling.  Harmony is tested to run on OSX >= 10.14 and Amazon Linux 2.  Command-line instructions and bash helper files under [bin/](bin/) are tested on OSX >= 10.14.
* [git](https://git-scm.com) - Used to clone this repository
* Mac:
  * Install [Docker Desktop] https://www.docker.com/products/docker-desktop. Docker Desktop comes bundled with Kubernetes and `kubectl`.
    If you encounter issues running `kubectl` commands, first make sure you are running the version bunedled with Docker Desktop.
  * Run Kubernetes in Docker Desktop by selecting Preferences -> Kubernetes -> Enable Kubernetes
* Linux / Generic:
  * Install [minikube](https://kubernetes.io/docs/tasks/tools/install-kubectl/), a single-node Kubernetes cluster useful for local development
  * Install [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/), a command line interface to Kubernetes.
* [Docker compose](https://docs.docker.com/compose/) version 1.20.0 or greater; preferably the latest version, which is v1.26 or greater.
* The [AWS CLI](https://aws.amazon.com/cli/) - Used to interact with both localstack and real AWS accounts
* [SQLite3 commandline](https://sqlite.org/index.html) - Used to create the local development and test databases. Install using your OS package manager, or [download precompiled binaries from SQLite](https://www.sqlite.org/download.html)
* PostgreSQL (required by the pg-native library) - `brew install postgresql` on OSX
* [Earthdata Login application in UAT](../edl-requirement.md)
* [envsubst](https://pypi.org/project/envsubst) - Used to substitute environment variable placeholders inside configuration files.
* [openssl](https://www.openssl.org/) Read [this installation guide](https://github.com/openssl/openssl/blob/master/NOTES-WINDOWS.md) if you're a Windows user and openssl is not installed on your machine already.

Highly Recommended:
* An Amazon Web Services account - Used for testing Harmony against object stores and running Harmony in AWS
* An editor with syntax awareness of TypeScript.  If you do not have this or any preference, consider [Visual Studio Code](https://code.visualstudio.com)

Optional:
* [awscli-local](https://github.com/localstack/awscli-local) - CLI helpers for interacting with localstack
* [Python](https://www.python.org) version 3.11 - Useful for locally running and testing harmony-docker and other backend services

## Set up Environment

If you have not yet cloned the Harmony repository, run
```
$ git clone https://github.com/nasa/harmony.git
```
Ensure `envsubst` is installed on your system.

For Mac, `envsubst` is part of the `homebrew` `gettext` package. Run
```
brew install gettext
```

if you are using `homebrew`. The version installed by `pip` is NOT compatible.

#### *** NOTE FOR M1 MACS ***
If you are running on an M1 Mac, you will have to run Harmony on Rosetta 2 due to some issues
with GDAL Node packages. To do this, run this command before following the rest of these instructions.

```
arch -x86_64 zsh
```

or

```
arch -x86_64 bash
```

Ensure node is available and is the correct version, 22.x.y.

```
$ node --version
v22.5.1
```

Ensure npm is available and is version 10 or later.
```
$ npm --version
9.8.1
```

If either are not the correct versions and you are using NVM, install them and ensure your `PATH` is up-to-date by running:

```
$ nvm install && nvm use
```

The output should include node 22 and npm 10.
```
Now using node v22.5.1 (npm v10.8.2)
```

Be sure to **verify the version on the final line** to make sure the NVM binary appears first in your `PATH`.

From the harmony project root, install library dependencies:
```
$ npm install
```

Recommended: Add `./node_modules/.bin` to your `PATH`.  This will allow you to run binaries from installed node modules.  If you choose not to do this, you will need to prefix node module calls with `npx`, e.g. `npx mocha` instead of just `mocha`

### Set Up Environment Variables

Harmony uses environment variables for managing much of its configuration. Most of the variables can be defaulted, and harmony provides those defaults suitable for local development in the `env-defaults` file. In order to set up the remaining variables, run the following from the harmony project root:

```
$ bin/create-dotenv
```

The script will create a file named `.env` in the root project directory containing only those parameters that cannot be defaulted. Open the file and update the values for any of the variables that are currently blank. Detailed information for the environment variables can be found in the `env-defaults` file.

Harmony reads both the `env-defaults` and `.env` files at startup to determine the configuration. To override any default values, set the desired value in the `.env` file. There is no need to duplicate parameters in the `.env` file if using the default value.

Specifically, you will need to add the following to your .env file:
Mac OS X
```
LOCALSTACK_HOST=localhost
WORK_ITEM_UPDATE_QUEUE_URL=http://localhost:4566/queue/work-item-update-queue
LARGE_WORK_ITEM_UPDATE_QUEUE_URL=http://localhost:4566/queue/large-work-item-update-queue
BACKEND_HOST=host.docker.internal
CALLBACK_URL_ROOT=http://host.docker.internal:3001
LOCAL_DEV=true

```

Linux
```
LOCALSTACK_HOST=localhost
WORK_ITEM_UPDATE_QUEUE_URL=http://localhost:4566/queue/work-item-update-queue
LARGE_WORK_ITEM_UPDATE_QUEUE_URL=http://localhost:4566/queue/large-work-item-update-queue
BACKEND_HOST=localhost
CALLBACK_URL_ROOT=http://localhost:3001
LOCAL_DEV=true
```

### (minikube only) Configuring the callback URL for backend services

You can skip this step if you are using the default docker driver for minikube and set CALLBACK_URL_ROOT as described in the example dotenv file. If you are using a different driver such as virtualbox you may need to execute the following command to get the IP address minikube has bridged to localhost:

```bash
minikube ssh grep host.minikube.internal /etc/hosts | cut -f1
```

This should print out an IP address. Use this in your .env file to specify the `CALLBACK_URL_ROOT` value, e.g., `CALLBACK_URL_ROOT=http://192.168.65.2:4001`.

## Run Harmony and Services

Harmony and the services can be run using the following:

```
./bin/bootstrap-harmony
./bin/start-dev-services
```

NOTE: You must set `LOCAL_DEV=true` before running these to prevent `bootstrap-harmony` from
starting harmony and its support services in kubernetes.

The provider services along with postgresql and localstack will now be running in kubernetes,
while Harmony and its support services will be running as local Node.js processes. Each process
has a specific port and debug port as shown in the following table:

| Process              | Port | Debug Port |
|----------------------|------|------------|
| harmony              | 3000 | 9200       |
| work-scheduler       | 5001 | 9201       |
| work-updater (large) | 5002 | 9202       |
| work-updater (small) | 5003 | 9203       |

## Stopping Harmony and Services

The services running in kubernetes can be stopped using the following (this will also delete
the `harmony` namespace):

```
./bin/stop-harmony-and-services
```

The Node.js processes for Harmony and its support services can be stopped using the following:
```
./bin/stop-dev-services
```


## Add A Service

Clone the Harmony service example repository into a peer directory of the main Harmony repo
```
$ cd ..
$ git clone https://github.com/nasa/harmony-service-example.git
```

(minikube only) From the harmony-service-example project root, run
```bash
eval $(minikube docker-env)
```

This will set up the proper environment for building the image so that it may be used in minikube.

Next run the following command to build and locally install the image:

```bash
./bin/build-image
```

This may take some time, but ultimately it will produce a local docker image tagged `harmonyservices/service-example:latest`. (The docker images for each service must be available locally in order for the k8s deployment to succeed.)

Create the k8s deployment:

```bash
./bin/deploy-services
```

If you'd like to build and test a new service for Harmony see [this reference](../testing-services.md).

### Deleting services and stopping Kubernetes

To delete all resources associated with deployed services, postgres and localstack deployment, run:

```
$ kubectl delete namespaces harmony
```

`minikube` users can stop Kubernetes by running `minikube stop`.  Docker Desktop users will
need to close Docker or disable Kubernetes support in the UI.  Note that the latter uninstalls `kubectl`.

## Run Harmony

To run Harmony locally such that it reloads when files change (recommended during development), run

```
$ npm run start-dev
```

In production, we use `$ npm run start` which does the same but does not add the file watching and reloading behavior.

You should see messages about the two applications listening on two ports, "frontend" and "backend."  The frontend application receives requests from users, while the backend application receives callbacks from services.

### Connect A Client

You should now be able to view the outputs of performing a simple transformation request.  Harmony has its own test collection
set up for sanity checking harmony with the harmony-service-example backend.  This will fetch a granule from that collection converted to GeoTIFF:
[http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?granuleId=G1233800343-EEDTEST&format=image/tiff](http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?granuleId=G1233800343-EEDTEST&format=image/tiff)

You can also set up a WMS connection in [QGIS](https://qgis.org/en/site/about/index.html), for example, by placing the
`http://localhost:3000/C1233800302-EEDTEST/wms` as the "URL" field input in the "Connection Details"
dialog when adding a new WMS connection.  Thereafter, expanding the connection should provide a list of layers obtained through a
GetCapabilities call to the test server, and double-clicking a layer should add it to a map, making a WMS call to retrieve an appropriate
PNG from the test server.

## Run Tests

To run the linter, tests, and coverage checks as the CI environment will, run

```
$ npm test
```

Harmony uses [eslint](https://eslint.org) as a linter, which can be invoked as `$ npx eslint` (or `$ eslint` if you have set up your `PATH`).  It uses [mocha](https://mochajs.org) for tests, `$ npx mocha`, and [nyc](https://istanbul.js.org) for code coverage, `$ npx nyc mocha`.

### Test Fixtures

Rather than repeatedly perform the same queries against the CMR, our test suite
uses [node-replay](https://github.com/assaf/node-replay) to record and play back
HTTP interactions.  All non-localhost interactions are recorded and placed in files
in the [fixtures directory](../../services/harmony/fixtures/).

By default, the test suite will playback interactions it has already seen and
record any new interactions to new files.  This behavior can be changed by setting
the `REPLAY` environment variable, as described in the
[node-replay README](https://github.com/assaf/node-replay).

To re-record everything, remove the fixtures directory and run the test suite. This should be done to cull the recordings when a code change makes many of them obsolete, when CMR adds response fields that Harmony needs to make use of, and periodically to ensure no impactful CMR changes or regressions.

## Building and Publishing the Harmony Docker Image

The Harmony Docker image can be built with the following command:
```bash
npm run build
```

The image can be deployed to DockerHub using the following commands:
```bash
npm run publish
```

## Building Images and Pushing them to the Sandbox ECR

1. Set your AWS profile to the sandbox, e.g., `export AWS_PROFILE=harmony-sandbox`
2. `VERSION=<some-tag> npm run build-all` (or `VERSION=<some-tag> npm run build-all-m1` if you are building
    on a Mac M1/M2 machine).
3. `VERSION=<some-tag> npm run push-image-all`

## Contributing to Harmony

We welcome Pull Requests from developers not on the Harmony
team. Please follow the standard "Fork and Pull Request" workflow
shown below.

### Submitting a Pull Request

If you are a developer on another team and would like to submit a Pull
Request to this repo:

1. Create a fork of the harmony repository.
2. When ready, submit a PR from the fork's branch back to the harmony
   master branch. Ideally name the PR with a Jira ticket name (e.g.,
   HARMONY-314).
3. The PR's 'build' tab should not show errors.

## Additional Resources

* [Adapting new services to Harmony](adapting-new-services.md)
* [Harmony message schemas](../../services/harmony/app/schemas/data-operation)
* [EOSS protocol OpenAPI Specification](../../services/harmony/app/schemas/eoss)
* [Harmony NetCDF to Zarr service repository](https://github.com/nasa/harmony-netcdf-to-zarr)
* [Harmony GDAL-based example service repository](https://github.com/nasa/harmony-service-example)
