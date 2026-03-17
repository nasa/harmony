import StatusChangeLinks from '../status-change-links.js';
import jobsTable from './jobs-table.js';
import toasts from '../toasts.js';
import PubSub from '../../pub-sub.js';

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
    const link = event.target;
    const jobIDs = jobsTable.getJobIds();
    const actionableJobIDs = this.getActionableJobIDs(jobIDs, link);
    const postfix = actionableJobIDs.length > 1 ? 's' : '';
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Are you sure you want to ${(link.textContent || link.innerText).trim()} ${actionableJobIDs.length} job${postfix}?`)) {
      return;
    }
    toasts.showUpper('Changing job state...');
    const stateChangeUrl = link.getAttribute('href');
    const res = await fetch(stateChangeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobIDs: actionableJobIDs }),
    });
    const data = await res.json();
    const isAre = actionableJobIDs.length > 1 ? 'are' : 'is';
    if (res.status === 200) {
      toasts.showUpper(`The selected job${postfix} ${isAre} now ${data.status}.`);
    } else if (data.description) {
      toasts.showUpper(data.description);
    } else {
      toasts.showUpper('The update failed.');
    }
    PubSub.publish(
      'row-state-change',
    );
  }

  /**
   * Filter the job IDs to only those jobs that can be operated on by the action
   * represented by the link's href attribute.
   * @param {string[]} jobIDs - the job IDs to filter
   * @param {EventTarget} link - the link whose href will be used as the filter
   * @returns filtered list of job IDs
   */
  getActionableJobIDs(jobIDs, link) {
    const actionableJobIDs = [];
    for (const jobID of jobIDs) {
      const links = this.fetchLinksForStatuses([jobsTable.getJobStatus(jobID)]);
      const jobHasTargetLink = links.some((linkForStatus) => link.getAttribute('href') === linkForStatus.href);
      if (jobHasTargetLink) {
        actionableJobIDs.push(jobID);
      }
    }
    return actionableJobIDs;
  }

  /**
   * Get job state change links (pause, resume, etc.) depending on jobs' statuses.
   * @param {string[]} statuses - fetch links relevant to these job statuses
   */
  fetchLinksForStatuses(statuses) {
    const links = [];
    const hasRunning = statuses.indexOf('running') > -1;
    const hasRunningWithErrors = statuses.indexOf('running_with_errors') > -1;
    const hasPreviewing = statuses.indexOf('previewing') > -1;
    const hasPaused = statuses.indexOf('paused') > -1;
    const hasActiveStatus = hasRunning || hasRunningWithErrors || hasPreviewing;
    if (hasActiveStatus || hasPaused) {
      links.push(cancelLink);
    }
    if (hasActiveStatus) {
      links.push(pauseLink);
    }
    if (hasPaused) {
      links.push(resumeLink);
    }
    if (hasPreviewing) {
      links.push(skipPreviewLink);
    }
    return links;
  }

  /**
   * Get job state change links (pause, resume, etc.), optionally depending on jobs' statuses.
   * @param {boolean} fetchAll - fetch all links or only those relevent to the
   * specified statuses
   */
  async fetchLinks(fetchAll) {
    if (fetchAll) {
      return [cancelLink, pauseLink, resumeLink, skipPreviewLink];
    }
    return this.fetchLinksForStatuses(jobsTable.getJobStatuses());
  }
}

export default JobsStatusChangeLinks;
