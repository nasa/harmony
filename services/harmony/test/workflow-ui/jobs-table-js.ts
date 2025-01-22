import { JSDOM } from 'jsdom';
import { expect } from 'chai';
import path from 'path';
import JobsTable from '../../public/js/workflow-ui/jobs/jobs-table';
import * as fs from 'fs';

beforeEach(async () => {
  const dom = await JSDOM.fromFile(path.resolve(__dirname, 'jobs.html'), { url: 'http://localhost' });
  global.window = dom.window as unknown as Window & typeof globalThis;
  global.document = dom.window.document;
});

describe('jobs-table.js', () => { 
  describe('handleSuccessResponse', () => {
    it('resets the jobs counter display to reflect the new set of selected rows', () => {
      const tableHtml = fs.readFileSync(path.resolve(__dirname, 'jobs-table.html'), 'utf-8');
      const count = document.getElementById('job-counter').textContent;
      expect(count).to.equal('0');
      JobsTable.handleSuccessResponse(tableHtml);
      const newCount = document.getElementById('job-counter').textContent;
      expect(newCount).to.equal('2');
    });
  });
});
