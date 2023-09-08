# Harmony Work Failer

This folder contains the code and build scripts for the Harmony work failer,
which is responsible for deleting work items and workflow steps  that have 
not been updated for a (configurable) period of time.

## Building the Work Failer for Local Use

1. Run `npm build` in this directory to build with the tag `latest`. To use a different tag,
   run `VERSION=tag npm run build`.

## Using the Work Failer Locally

1. If you are using an image tag other than `latest` set `WORK_failer_IMAGE=harmonyservices/work-failer:<tag>` in your harmony .env file
2. Run `bin/deploy-services` from the harmony repository

## Running the Repaer Outside of Docker for Development

If you are doing development of the failer itself it is convenient to run it as a stand-alone process outside of Docker. This can be done by first removing the version running in
kubernetes then starting up a node.js process to run the updater.
1. `kubectl delete deployment harmony-work-failer -n harmony`
2. `kubectl delete service harmony-work-failer -n harmony`
3. `npm run start-dev-fast` (from this directory)

## Pushing the Docker Image to ECR

If you want to do sandbox deployments with your custom updater image then you need to
push it to ECR. This can be done as follows:

1. (only needed if building on Mac to build for AMD64 architecture)
   `VERSION=<image-tag> npm run build-m1`
2. `bin/push-image <image-tag>`

This requires you to have your AWS credentials set for your sandbox.