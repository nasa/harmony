/**
 * Handles polling for work items and loading the work items
 * table as a job is in progress.
 */
export class WorkFlowItemsTable {

  constructor(jobId, page, limit) {
    const fiveSeconds = 5 * 1000;
    this.tableUrl = `./table/${jobId}?page=${page}&limit=${limit}`;
    this._loadTable(true);
    this._startPolling(fiveSeconds, true);
  }

  /**
   * Start polling for the work items table, every interval ms.
   * @param {number} interval - polling interval in ms
   * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
   */
  async _startPolling(interval, checkJobStatus) {
    this.intervalId = setInterval(() => this._loadTable(checkJobStatus), interval);
  }

  /**
   * Stop polling for the work items table.
   */
  _stopPolling() {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  /**
   * Query the Harmony backend for an up to date version of 
   * a single page of the work items table.
   * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
   */
  async _loadTable(checkJobStatus) {
    const res = await fetch(this.tableUrl + `&checkJobStatus=${checkJobStatus}`);
    if (res.status === 200) {
      const template = await res.text();
      document.getElementById('workflow-items-table-container').innerHTML = template;
    } else {
      // the job likely has finished, so back off on the polling interval
      // but keep polling in case work items are still being updated
      const fifteenSeconds = 15 * 1000;
      this._stopPolling();
      this._loadTable(false);
      this._startPolling(fifteenSeconds, false);
    }
  }
}