import StatusChangeLinks from '../status-change-links.js';
import jobsTable from './jobs-table.js';

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
    console.log(jobsTable.getJobIds());
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
    // TODO - ordering of links
    const links = new Set();
    const statuses = jobsTable.getJobStatuses();
    if ((statuses.indexOf('running') > -1)
      || (statuses.indexOf('running_with_errors') > -1)) {
        links.add(cancelLink);
        links.add(pauseLink);
    }
    if ('paused' in statuses) {
      links.add(cancelLink);
      links.add(resumeLink);
    }
    if (statuses.indexOf('previewing') > -1) {
      links.add(cancelLink);
      links.add(pauseLink);
      links.add(skipPreviewLink);
    }
    return Array.from(links);
  }
}

export default JobsStatusChangeLinks;
