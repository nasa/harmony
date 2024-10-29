import { JSDOM } from 'jsdom';
import { expect } from 'chai';
import path from 'path';
import Labels from '../../public/js/workflow-ui/labels';

beforeEach(async () => {
  const dom = await JSDOM.fromFile(path.resolve(__dirname, 'labels.html'), { url: 'http://localhost' });
  global.window = dom.window as unknown as Window & typeof globalThis;
  global.document = dom.window.document;
});

describe('labels.js', () => { 
  describe('promoteLabels', () => {
    it('promotes the given list of labels', () => {
      const labelsListElement = document.getElementById('labels-list');
      const greenLi = labelsListElement.querySelector('a[name="green"]').closest('li');
      Labels.promoteLabels(['green']);
      const isPromoted = greenLi.classList.contains('label-promoted');
      expect(isPromoted);
    });
  });
});