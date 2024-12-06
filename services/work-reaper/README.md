# Harmony Work Reaper

This folder contains the code and build scripts for the Harmony work reaper,
which is responsible for deleting work items and workflow steps that have
not been updated for a (configurable) period of time.

## Building the Work Reaper for Local Use

1. Run `npm build` in this directory to build with the tag `latest`. To use a different tag,
   run `VERSION=tag npm run build`.

## Using the Work Reaper Locally

1. If you are using an image tag other than `latest` set `WORK_REAPER_IMAGE=harmonyservices/work-reaper:<tag>` in your harmony .env file
2. Run `bin/deploy-services` from the harmony repository

## Running the Reaper Outside of Docker for Development

If you are doing development of the reaper itself it is convenient to run it as a stand-alone process outside of Docker.
This can be done by first removing the version running in kubernetes then starting up a node.js process to run the reaper.
1. `kubectl delete deployment harmony-work-reaper -n harmony`
2. `kubectl delete service harmony-work-reaper -n harmony`
3. `npm run start-dev-fast` (from this directory)

## Pushing the Docker Image to ECR

If you want to do sandbox deployments with your custom reaper image then you need to
push it to ECR. This can be done as follows:

1. (only needed if building on Mac to build for AMD64 architecture)
   `VERSION=<image-tag> npm run build-m1`
2. `bin/push-image <image-tag>`

This requires you to have your AWS credentials set for your sandbox.