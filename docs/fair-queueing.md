# Fair Queueing <!-- omit in toc -->

**IMPORTANT! This documentation concerns features under active development. The algorithm described here may undergo changes in the future.**

## Table of Contents<!-- omit in toc -->
- [Introduction](#introduction)
- [Background](#background)
- [The Algorithm](#the-algorithm)

## Introduction
Harmony supports two goals with regard to processing work for users. These are referred to
collectively as _fair queueing_:

* When a user performs a Harmony request and no other users are currently in the system, Harmony provides all available resources to that user
* When a user performs a Harmony request and other users currently have requests pending in the system, Harmony shares available resources evenly between the user requests (prioritizing synchronous calls)

## Background
Harmony orchestrates multiple services that can be invoked on data. These services
can be chained together (where appropriate) to form complex workflows involving both
sequential services chains in which the output of one service becomes the input of the
next service, as well as output aggregation where a services receives the output from
multiple services as its input.

Workers for each service are run as pods in a Kubernetes cluster. These workers
request a unit of work (a 'work item') from the Harmony backend, process the associated work item, save the results in S3, then send a status update to the Harmony backend.

Fair queueing is the process by which Harmony decides which work item to send to a service
requesting work. More generally, it answers the question, "of the users needing work 
performed by a given service, which user should go next?". 
 
## The Algorithm
The steps to perform fair queueing in harmony can be summarized as follows:

When a worker requests a work item for a given service

1. Identify all the users actively requesting work to be done on the service
2. From the list of identified users, determine which user had work performed (for any service) least recently
3. From that user's list of jobs (only those invoking the service) sort the jobs by the `isAsync` column to favor synchronous jobs, then sort by the `updatedAt` column to identify the job that has been worked least recently - return a work item for that job for the given service
4. Update the work item and job timestamps in the database to indicate work being done at the current point in time

All of the above are done inside a database transaction with locking to prevent a
work item from being issued more than once.

Note that this implicitly satisfies the first requirement as there will only be one user identified in step 1. Note also that this satisfies the second requirement including prioritizing synchronous calls.