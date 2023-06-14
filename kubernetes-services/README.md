# Kubernetes Task Services

This directory contains sub-projects for tasks that are run as kubernetes services. Not to be
confused with `Harmony services` that operate on actual data, these tasks are associated with
the inner plumbing of scheduling work-items, processing work-item updates, etc.

These projects provide Docker files for building images as well as kubernetes manifest yaml files
that define the deployments and services. The manifests can be used with `kubectl` to deploy
the services.

## Creating a Task Service

The easiest way to create a new task service is to copy the `work-scheduler` directory to a new
directory under this (kubernetes-services) folder, then modify the code to do what you want.
`work-scheduler` is a small `Nodes.js` `Express` app that uses the `Worker` class/pattern as
defined in `app/workers.ts`. The `Express` server provides a health check endpoint for kubernetes
while the `Worker` performs the real work of the application.

For new services it may be useful to add a `metrics` route to this server so that `Prometheus`
can scrape it to drive an HPA, but that is beyond the scope of this discussion.

The specific steps to create a new service are

1. `cd kubernetes-services`
2. `cp work-scheduler <new service>`
3. Modify the code in the `app` and `test` directories to implement/test your service.
4. Modify the `Dockerfile`, `env-defaults`, and `config/service-template.yml` files as well as
   the push scripts in the `bin` directory as needed.
5. `cd <new service>`
6. Build the Docker image with `npm run build`.
7. Deploy the service with `kubectl -n harmony apply -f ./config/service-template.yaml`

For sandbox deployments you can use the push scripts in the `bin` directory combined with `npm`
to build and deploy your image to AWS ECR:

1. Set your AWS profile to the sandbox, e.g., `export AWS_PROFILE=harmony-sandbox`
2. `VERSION=<some-tag> npm run build` (or `VERSION=<some-tag> npm run build-m1` if you are building
    on a Mac M1/M2 machine).
3. `bin/push-image-aws-cli2 <some-tag>`

The service can be run directly during development using `npm run start-dev-fast` rather than
running it as a kubernetes service. This is much more convenient than continually building the
Docker image and redeploying.