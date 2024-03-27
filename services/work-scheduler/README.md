# Harmony Work Scheduler

This folder contains the code and build scripts for the Harmony work scheduler,
which is responsible for putting work-items on the service queues.

## Building the Work Scheduler
1. Run `pnpm build` in this directory to build with the tag `latest`. To use a different tag,
   run `VERSION=tag pnpm build`.

## Using the Scheduler Locally

1. Set `USE_SERVICE_QUEUES=true` in your .env file for the harmony repository
2. If you are using an image tag other than `latest` set `WORK_ITEM_SCHEDULER_IMAGE=harmonyservices/work-scheduler:<tag>` in your harmony .env file
3. Run `bin/deploy-services` from the harmony repository

## Running the Scheduler Outside of Docker for Development

If you are doing development of the scheduler itself it is convenient to run it as a stand
alone process outside of Docker. This can be done by first removing the version running in
kubernetes then starting up a node.js process to run the scheduler.
1. `kubectl delete deployment harmony-work-scheduler -n harmony`
2. `kubectl delete service harmony-work-scheduler -n harmony`
3. `pnpm start-dev-fast` (from this directory)

## Pushing the Docker Image to ECR

If you want to do sandbox deployments with your custom scheduler image then you need to
push it to ECR. This can be done as follows:

1. (only needed if building on Mac to build for AMD64 architecture)
   `VERSION=<image-tag> pnpm build-m1`
2. `VERSION=<image-tag> pnpm push-image`

This requires you to have your AWS credentials set for your sandbox.