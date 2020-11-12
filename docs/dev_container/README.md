# Using a Dev Container for Harmony Development

This README includes what is needed to develop for and run Harmony in a dev container as well as its supporting software in sibling containers within some sort of VM host. If you haven't already, please read the primary [README.md](../README.md) first.

The following was tested on Windows 10 running Docker Desktop 2.4.0.0 on Hyper-V.

## Development Prerequisites

The following documentation assumes you are using:

* Docker Desktop with a bundled Kubernetes distribution
* Visual Studio Code


## Dev Container

### vCPUs and Docker Desktop Stability

If you experience occasional container lock-ups you may want to verify Docker Desktop is configured to use only 2 Cores (Settings -> Resources -> Advanced: CPUs). Also, verify you're not getting low on available host memory.

### SSL Inspection

If your organization's network runs a transparent SSL man-in-the-middle and you normally operate with a fake root CA then you'll want to include your .crt file under the relevant COPY line of the dev container Dockerfile - search for 'DOIRootCA.crt' and replace this with the filename of your root CA.

Most but not all network operations will be able to use this. One thing known to not use system configured CA's is [node-gyp](https://github.com/nodejs/node-gyp) which fails with the following:

```
gyp WARN install got an error, rolling back install
gyp ERR! configure error 
gyp ERR! stack Error: unable to get local issuer certificate
gyp ERR! stack     at TLSSocket.onConnectSecure (_tls_wrap.js:1502:34)
gyp ERR! stack     at TLSSocket.emit (events.js:314:20)
gyp ERR! stack     at TLSSocket._finishInit (_tls_wrap.js:937:8)
gyp ERR! stack     at TLSWrap.ssl.onhandshakedone (_tls_wrap.js:711:12)
gyp ERR! System Linux 4.19.76-linuxkit
gyp ERR! command "/home/dockeruser/.nvm/versions/node/v12.19.0/bin/node" "/home/dockeruser/.nvm/versions/node/v12.19.0/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" "rebuild"
gyp ERR! cwd /home/dockeruser/.nvm/versions/node/v12.19.0/lib/node_modules/libpq
gyp ERR! node -v v12.19.0
gyp ERR! node-gyp -v v5.1.0
gyp ERR! not ok 
npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm ERR! libpq@1.8.9 install: `node-gyp rebuild`
npm ERR! Exit status 1
npm ERR! 
npm ERR! Failed at the libpq@1.8.9 install script.
npm ERR! This is probably not a problem with npm. There is likely additional logging output above.
```

A workaround is to either disconnect from your VPN or otherwise join a network which doesn't have transparent SSL inspection during Docker image building. This is also needed when building docker images for services like `harmony-gdal`.

### Windows, Git and LF vs. CRLF

If you wish to clone Harmony project repositories into your Windows filesystem and share repo directories via volume mount in your dev container, you'll want to consistently use LF instead of CRLF for line breaks. Just a reminder that the Unix world uses LF whereas Windows decided on CRLF back in DOS days.

`git config` has --global, --system, and --local settings and these settings may be overridden with a `.gitattributes` file as well. By default your Windows git installation may be configured to `core.autocrlf true` which pushes code with LF line endings but will use CRLF for local development. VSCode can work with either line ending but the linux dev container will see CRLF - e.g. when using `npm test`:

> revealed 19975 errors of: 198:6  error  Expected linebreaks to be 'LF' but found 'CRLF'  linebreak-style

Using one of the options above you'll want to set `core.autocrlf` to `false`.

### Kubernetes and Authentication

In order to make a Kubernetes API request with `kubectl` it:
* must be able to verify Transport Security (trust API TLS)

and the Kubernetes API service must allow the client to pass:
* Authentication
* Authorization
* and Admission Control

For dev environment purposes, the easiest way to handle this is by copying the VM's `/etc/kubernetes/admin.conf` into the dev container's local user home dir (e.g. `/home/dockeruser/.kube/config`).

Additionally, if you're using Windows and Hyper-V you may you may be unable to can't get a console on the VM via Hyper-V Manager. Without SSH, file system access or a console, one workaround is to run a privileged container for console access. The Dockerfile for this container is at [hostenter_Dockerfile](hostenter_Dockerfile). After entering the VM, copy and paste the admin.conf file from the privileged container console to your main host at .kube/config. dev_container_Dockerfile is set up to COPY .kube/config into ~/.kube/config.

Once completed, test `kubectl` by running the following:

> kubectl get nodes

If you can retrieve node information then you're good to go. These steps will need to be repeated if you re-deploy Kubernetes or re-install Docker Desktop.

### Argo, Localstack, and Harmony

After starting each of these services (the first two via Kubernetes and Harmony manually) you will need to forward host ports via VSCode's Remote Explorer interface.

### .env settings

In addition to the instructions regarding the .env file in the primary README.md, you will need the following:

```
ARGO_URL=http://host.docker.internal:2746
BACKEND_HOST=host.docker.internal
DIND=true
KUBE_CONTEXT=kubernetes-admin@kubernetes
KUBERNETES_URL=https://vm.docker.internal:6443
LOCALSTACK_MOUNT=/workspaces/harmony/localstack_tmp
```


## Set Up Environment

* Install Docker Desktop
* Install VSCode along with the [Remote Container Extension](https://code.visualstudio.com/docs/remote/containers)
* Follow the instructions above
* Build the Dev Container image
   * In VSCode, if you do `Remote Containers: Open Folder in Container' and that folder has the dev container Dockerfile, VSCode can build the image for you
* Follow the primary Harmony repo [README.md](../README.md)