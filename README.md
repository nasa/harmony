# Harmony

Services. Together.

Harmony has two fundamental goals in life:
1. **Services** - Increase usage and ease of use of EOSDIS' data, especially focusing on opportunities made possible now that data from multiple DAACs reside in AWS.  Users should be able to work seamlessly across data from different DAACs in ways previously unachievable.
2. **Together** - Transform how we, as a development community, work together to accomplish goal number 1.  Let's reuse the simple, but necessary components (e.g. EDL, UMM, CMR and Metrics integration) and let's work together on the stuff that's hard (and fun) like chaining, scaling and cloud optimizations.

This README is devoted to the Harmony "Quick Start". If you're looking for something else, you should consult:

* [The guides directory](docs/guides) (advanced guides, covering things like developing Harmony and services from scratch)
* EOSDIS #harmony, #harmony-service-providers Slack channel
* [Harmony wiki](https://wiki.earthdata.nasa.gov/display/Harmony) (project-facing information)

# Quick Start (Mac OS X / Linux)

This is the quickest way to get started with Harmony (by running Harmony in a container). If you are interested in using a local Harmony instance to develop services, but not interested in developing the Harmony code itself, this mode of running Harmony should suit you well. For more advanced use cases, see the [Develop](docs/guides/develop.md) guide.

1. First, ensure you have the minimum system requirements:
* A running [Docker Desktop](https://www.docker.com/products/developer-tools) or daemon instance - Used to invoke docker-based services.
* A running [Kubernetes](https://kubernetes.io/) cluster with the [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/) command. [Docker Desktop](https://www.docker.com/products/docker-desktop) for Mac and Windows comes with a
built-in Kubernetes cluster (including `kubectl`) which can be enabled in preferences. Minikube is a popular Linux alternative for running Kubernetes locally.
* [openssl](https://www.openssl.org/) Read [this installation guide](https://github.com/openssl/openssl/blob/master/NOTES-WINDOWS.md) if you're a Windows user and openssl is not installed on your machine already.
* [Earthdata Login application in UAT](docs/edl-requirement.md)

2. Download this repository (or download the zip file from GitHub)
```bash
git clone https://github.com/nasa/harmony.git
```

3. Run the `create-dotenv` script in the `bin` directory and answer the prompts to
   create a `.env` file.
  ```bash
  pushd harmony && ./bin/create-dotenv && popd
  ```
   Edit the `.env` file if you want to add any image tags for a custom service (see the `env-defaults` file). You can skip this step for now if you just want to use the default service tags.

4. Run the bootstrap script and answer the prompts (if any)
```bash
cd harmony && ./bin/bootstrap-harmony
```

Linux Only (Handled automatically by Docker Desktop)

5. Expose the kubernetes services to the local host. These commands will block so they must be run in separate terminals.
```bash
kubectl port-forward service/harmony 3000:3000 -n harmony
```

**NOTE** The workflow listener will fail repeatedly (restarts every 30 seconds) when Harmony is run
in Kubernetes on Linux. This is a known bug and is to addressed in Jira ticket HARMONY-849.

Harmony should now be running in your Kubernetes cluster as the `harmony` service in the `harmony` namespace.

**NOTE** It may take a while for all the pods to start if this is the first time you have started
Harmony. You can check on the status by running the following command:

```bash
kubectl get pods -n harmony
```

When all the pods are in the 'Running' state then Harmony is ready to go. If you installed
the example harmony service you can test it with the following (requires a [.netrc](https://www.gnu.org/software/inetutils/manual/html_node/The-_002enetrc-file.html) file):

```bash
curl -Ln -bj "http://localhost:3000/C1233800302-EEDTEST/ogc-api-coverages/1.0.0/collections/all/coverage/rangeset?granuleId=G1233800343-EEDTEST" -o file.tif
```

We recommend using [harmony-py](https://github.com/nasa/harmony-py) and its example notebook when working with Harmony.

### Updating the Local Harmony Instance

You can update Harmony by running the `bin/update-harmony` script. This will pull the latest Harmony Docker images from DockerHub and
restart Harmony.

**NOTE** This will recreate the jobs database, so old links to job statuses will no longer work. Also, since it
pulls the harmony image from DockerHub it will overwrite any local changes you have made to the image. This is also
true for the query-cmr image. This script is intended for service developers not working directly on the harmony
source code.

You can include the `-s` flag to update service images as well, e.g.,

```bash
./bin/update-harmony -s
```

### Reloading the Services Configuration

If you modify the `services.yml` file Harmony will need to be restarted. You can do this with the following command:

```bash
./bin/reload-services-config
```
**NOTE** This will recreate the jobs database, so old links to job statuses will no longer work.

### Testing New Services

If you'd like to build a new service for Harmony, see [Adapting New Services](docs/guides/adapting-new-services.md). If you already have a service ready to test, read the [testing services](docs/testing-services.md) reference.