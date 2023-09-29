import StatusChangeLinks from '../status-change-links.js';
import jobsTable from './jobs-table.js';
import toasts from '../toasts.js';

const cancelLink = {
  title: 'Cancels the job.',
  href: '/jobs/cancel',
  type: 'application/json',
  rel: 'canceler',
};

const pauseLink = {
  title: 'Pauses the job.',
  href: '/jobs/pause',
  type: 'application/json',
  rel: 'pauser',
};

const resumeLink = {
  title: 'Resumes the job.',
  href: '/jobs/resume',
  type: 'application/json',
  rel: 'resumer',
};

const skipPreviewLink = {
  title: 'Skips preview and runs the job.',
  href: '/jobs/skip-preview',
  type: 'application/json',
  rel: 'preview-skipper',
};

/**
 * Links for changing job status(es) (for the jobs page of the Workflow UI).
 */
class JobsStatusChangeLinks extends StatusChangeLinks {
  /**
   * Responds to a nav link click event
   * (hits relevant Harmony url, shows user the response).
   * @param {Event} event - the click event
   */
  async handleClick(event) {
    event.preventDefault();
    toasts.showUpper('Changing job state...');
    const link = event.target;
    const stateChangeUrl = link.getAttribute('href');
    const jobIDs = jobsTable.getJobIds();
    const res = await fetch(stateChangeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobIDs }),
    });
    const data = await res.json();
    const postfix = jobIDs.length > 1 ? 's' : '';
    const isAre = jobIDs.length > 1 ? 'are' : 'is';
    if (res.status === 200) {
      toasts.showUpper(`The job${postfix} ${isAre} now ${data.status}. Please reload the page to view updates.`);
      // TODO - handle rows refresh and make table refresh on interval
      // Should rows disappear if updated rows don't match table filters?
    } else if (data.description) {
      toasts.showUpper(data.description);
    } else {
      toasts.showUpper('The update failed.');
    }
  }

  /**
   * Get job state change links (pause, resume, etc.) depending on jobs' statuses.
   * @param {boolean} fetchAll - fetch all links or only those relevent to the
   * selected jobs
   */
  async fetchLinks(fetchAll) {
    if (fetchAll) {
      return [cancelLink, pauseLink, resumeLink, skipPreviewLink];
    }
    const links = [];
    const statuses = jobsTable.getJobStatuses();
    const hasRunning = statuses.indexOf('running') > -1;
    const hasRunningWithErrors = statuses.indexOf('running_with_errors') > -1;
    const hasPreviewing = statuses.indexOf('previewing') > -1;
    const hasPaused = statuses.indexOf('paused') > -1;
    const hasCompleteWithErrors = statuses.indexOf('complete_with_errors') > -1;
    const hasCanceled = statuses.indexOf('canceled') > -1;
    const hasFailed = statuses.indexOf('failed') > -1;
    const hasSuccessful = statuses.indexOf('successful') > -1;
    const hasTerminalStatus = hasCompleteWithErrors || hasCanceled || hasFailed || hasSuccessful;
    if (hasTerminalStatus) {
      return [];
    }
    const hasActionableStatus = hasRunning || hasRunningWithErrors || hasPreviewing || hasPaused;
    if (hasActionableStatus) {
      links.push(cancelLink);
    }
    if (!hasPaused && hasActionableStatus) {
      links.push(pauseLink);
    }
    if (hasPaused && !hasRunning && !hasRunningWithErrors && !hasPreviewing) {
      links.push(resumeLink);
    }
    if (hasPreviewing && !hasRunning && !hasRunningWithErrors && !hasPaused) {
      links.push(skipPreviewLink);
    }
    return links;
  }
}

export default JobsStatusChangeLinks;
