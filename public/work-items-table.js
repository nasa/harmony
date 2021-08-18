export class WorkItemsTable {
  
    constructor() {
      this.shouldPoll = true;
    }
  
    async startPolling() {
      const jobID = window.location.href.split("/").pop();
      const tableUrl = `./table/${jobID}`;
      this._pollLoadTable(tableUrl);
      this.intervalId = setInterval(() => this._pollLoadTable(tableUrl), (2 * 1000));
    }
  
    async _pollLoadTable(tableUrl) {
      if(this.shouldPoll) {
        await this._loadTable(tableUrl);
      }
    }
  
    async _loadTable(tableUrl) {
      const res = await fetch(tableUrl);
      const template = await res.text();
      document.getElementById('workflow-items-table-col').innerHTML = template;     
    }
  }  