import { canTransition, JobEvent, JobStatus, SerializedJob } from '../models/job';
import JobLink from '../models/job-link';
import env = require('./env');

const { awsDefaultRegion } = env;

export interface Link {
  href: string;
  title: string;
  rel: string;
  type: string;
}

/**
 * Returns a link to the cloud-access JSON endpoint
 *
 * @param urlRoot - The harmony root URL
 * @returns the link to the cloud-access JSON endpoint
 */
export function getCloudAccessJsonLink(urlRoot: string): Link {
  return {
    title: `Access keys for s3:// URLs, usable from AWS ${awsDefaultRegion} (JSON format)`,
    href: `${urlRoot}/cloud-access`,
    rel: 'cloud-access-json',
    type: 'application/json',
  };
}

/**
 * Returns a link to the cloud-access shell script endpoint
 *
 * @param urlRoot - The harmony root URL
 * @returns the link to the cloud-access shell script endpoint
 */
export function getCloudAccessShLink(urlRoot: string): Link {
  return {
    title: `Access keys for s3:// URLs, usable from AWS ${awsDefaultRegion} (Shell format)`,
    href: `${urlRoot}/cloud-access.sh`,
    rel: 'cloud-access-sh',
    type: 'application/x-sh',
  };
}

/**
 * Returns a link to the STAC catalog for the given job
 *
 * @param urlRoot - The harmony root URL
 * @param jobID - The UUID of the job
 * @returns the link to the STAC catalog
 */
export function getStacCatalogLink(urlRoot: string, jobID: string): Link {
  return {
    title: 'STAC catalog',
    href: `${urlRoot}/stac/${jobID}/`,
    rel: 'stac-catalog-json',
    type: 'application/json',
  };
}

/**
 * Returns a link to the status page for the job
 *
 * @param urlRoot - The harmony root URL
 * @param jobID - The UUID of the job
 * @param rel - The type of relation (self|item)
 * @returns the link to the STAC catalog
 */
export function getStatusLink(urlRoot: string, jobID: string, rel: string): Link {
  return {
    title: 'Job Status',
    href: `${urlRoot}/jobs/${jobID}`,
    rel,
    type: 'application/json',
  };
}

/**
 * Given a job event, return the JobLink representing the corresponding event.
 * @param event - the event being triggered by the JobLink
 * @param jobID - the jobID that this link is for
 * @param urlRoot - the root url to use in the link
 * @param isAdmin - whether to include /admin in the link
 * @returns - the job link for the job event
 */
function getLinkForJobEvent(
  event: JobEvent, 
  jobID: string, 
  urlRoot: string, 
  isAdmin = false,
): JobLink {
  const adminPath = isAdmin ? '/admin' : '';
  switch (event) {
    case JobEvent.RESUME:
      return new JobLink({
        title: 'Resumes the job.',
        href: `${urlRoot + adminPath}/jobs/${jobID}/resume`,
        type: 'application/json',
        rel: 'resumer',
      });
    case JobEvent.SKIP_PREVIEW:
      return new JobLink({
        title: 'Skips preview and runs the job.',
        href: `${urlRoot + adminPath}/jobs/${jobID}/skip-preview`,
        type: 'application/json',
        rel: 'preview-skipper',
      });
    case JobEvent.CANCEL:
      return new JobLink({
        title: 'Cancels the job.',
        href: `${urlRoot + adminPath}/jobs/${jobID}/cancel`,
        type: 'application/json',
        rel: 'canceler',
      });
    case JobEvent.PAUSE:
      return new JobLink({
        title: 'Pauses the job.',
        href: `${urlRoot + adminPath}/jobs/${jobID}/pause`,
        type: 'application/json',
        rel: 'pauser',
      });
  }
}

/**
 * Return a set of JobEvents representing the actions that are currently available
 * to a user for a particular job.
 * Note that this only returns actions that users can precipitate via state change links
 * (e.g. JobEvent.FAIL will not be returned).
 * @param job - the serialized job to return valid actions (JobEvents) for
 * @returns a set of JobEvent
 */
export function getLinkRelevantJobEvents(job: SerializedJob): Set<JobEvent> {
  const transitions: [JobEvent, JobStatus][] = [
    // [event, resultant status]
    [JobEvent.CANCEL, JobStatus.CANCELED],
    [JobEvent.PAUSE, JobStatus.PAUSED], 
    [JobEvent.RESUME, JobStatus.RUNNING], 
  ];
  if (job.status === JobStatus.PREVIEWING) {
    // This may be a valid transition for other states, but we
    // are only interested in it when the job is currently previewing.
    // e.g. skipping preview is valid for a paused job but doesn't make sense to a user
    transitions.push([ JobEvent.SKIP_PREVIEW, JobStatus.RUNNING ]);
  }
  const validEvents = new Set<JobEvent>();
  for (const [event, newStatus] of transitions) {
    if (canTransition(job.status, newStatus, event)) {
      validEvents.add(event);
    }
  }
  return validEvents;
}

/**
 * Generate links that represent the actions that are available to a user with
 * respect to job status state transitions (cancel, pause, etc.).
 * @param job - the serialized job to generate links for
 * @param urlRoot - the root url for the links being generated 
 * @param isAdmin - boolean representing whether we are generating links for 
 * an admin request
 * @returns JobLink[]
 */
export function getJobStateChangeLinks(
  job: SerializedJob,
  urlRoot: string,
  isAdmin = false,
): JobLink[] {
  const events = Array.from(getLinkRelevantJobEvents(job).values());
  return events.map((event) => getLinkForJobEvent(event, job.jobID, urlRoot, isAdmin));
}

/**
 * Generate links that represent all of the actions that are available to a user with
 * respect to job status state transitions (cancel, pause, etc.).
 * @param job - the job to generate links for
 * @param urlRoot - the root url for the links being generated 
 * @param isAdmin - boolean representing whether we are generating links for 
 * an admin request
 * @returns JobLink[]
 */
export function getAllStateChangeLinks(
  job: SerializedJob,
  urlRoot: string,
  isAdmin = false,
): JobLink[] {
  const events = [JobEvent.CANCEL, JobEvent.PAUSE, JobEvent.RESUME, JobEvent.SKIP_PREVIEW];
  return events.map((event) => getLinkForJobEvent(event, job.jobID, urlRoot, isAdmin));
}