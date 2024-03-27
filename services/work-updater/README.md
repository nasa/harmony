# Harmony Work Updater

This folder contains the code and build scripts for the Harmony work updater,
which is responsible for reading work-item updates from a queue and handling processing them.

## Building the Work Updater for Local Use

1. Run `pnpm build` in this directory to build with the tag `latest`. To use a different tag,
   run `VERSION=tag pnpm build`.

## Using the Updater Locally

1. If you are using an image tag other than `latest` set `WORK_ITEM_UPDATER_IMAGE=harmonyservices/work-updater:<tag>` in your harmony .env file
2. Run `bin/deploy-services` from the harmony repository

## Running the Updater Outside of Docker for Development

If you are doing development of the updater itself it is convenient to run it as a stand
alone process outside of Docker. This can be done by first removing the version running in
kubernetes then starting up a node.js process to run the updater.
1. `kubectl delete deployment harmony-work-updater -n harmony`
2. `kubectl delete service harmony-work-updater -n harmony`
3. `pnpm start-dev-fast` (from this directory)

## Pushing the Docker Image to ECR

If you want to do sandbox deployments with your custom updater image then you need to
push it to ECR. This can be done as follows:

1. (only needed if building on Mac to build for AMD64 architecture)
   `VERSION=<image-tag> pnpm build-m1`
2. `VERSION=<image-tag> pnpm push-image`

This requires you to have your AWS credentials set for your sandbox.