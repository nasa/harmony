export class WorkFlowItemsTable {
  
    constructor(jobId, page, limit) {
      this.shouldPoll = true;
      this.tableUrl = `./table/${jobId}?page=${page}&limit=${limit}`;
    }
  
    async startPolling() {
      this._pollLoadTable();
      this.intervalId = setInterval(() => this._pollLoadTable(), (2 * 1000));
    }
  
    stopPolling() {
      this.shouldPoll = false;
    }

    async _pollLoadTable() {
      if(this.shouldPoll) {
        await this._loadTable();
      } else {
        clearInterval(this.intervalId);
      }
    }
  
    async _loadTable() {
      const res = await fetch(this.tableUrl);
      const template = await res.text();
      document.getElementById('workflow-items-table-container').innerHTML = template;     
    }
  }  