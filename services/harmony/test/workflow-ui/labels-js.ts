import { JSDOM } from 'jsdom';
import { expect } from 'chai';
import path from 'path';
import Labels from '../../public/js/workflow-ui/labels';

beforeEach(async () => {
  const dom = await JSDOM.fromFile(path.resolve(__dirname, 'jobs.html'), { url: 'http://localhost' });
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
  describe('demoteLabels', () => {
    it('demotes all promoted labels and removes clones', () => {
      const labelsListElement = document.getElementById('labels-list');
      Labels.promoteLabels(['green']);
      Labels.demoteLabels();
      const greenLi = labelsListElement.querySelector('a[name="green"]').closest('li');
      const isPromoted = greenLi.classList.contains('label-promoted');
      expect(!isPromoted);
      const clones = Array.from(document.getElementsByClassName('label-clone'));
      expect(clones.length).to.equal(0);
    });
  });
  describe('getLabelsIntersectionForSelectedJobs', () => {
    it('gets the intersection set of labels for selected jobs', () => {
      (document.getElementById('select-058184f7-498c-4aa5-a3df-96a3a49b7d19') as HTMLInputElement).checked = true;
      (document.getElementById('select-38d2b820-0b52-475d-8cb0-0b9f7775f767') as HTMLInputElement).checked = true;
      expect(Labels.getLabelsIntersectionForSelectedJobs()).to.deep.equal(['blue']);
    });
    it('returns [] when there are no selected jobs', () => {
      expect(Labels.getLabelsIntersectionForSelectedJobs()).to.deep.equal([]);
    });
  });
  describe('setLabelLinksDisabled', () => {
    it('sets all label links disabled when 0 jobs are selected', () => {
      const labelLinks = Array.from(document.querySelectorAll('#labels-list .label-li a'));
      Labels.setLabelLinksDisabled(0, labelLinks);
      const disabledLabelLinks = Array.from(document.querySelectorAll('#labels-list .label-li a.disabled'));
      expect(disabledLabelLinks.length).to.equal(3);
    });
  });
  describe('setLabelLinksEnabled', () => {
    it('sets all label links enabled', () => {
      const labelLinks = Array.from(document.querySelectorAll('#labels-list .label-li a'));
      Labels.setLabelLinksDisabled(0, labelLinks);
      Labels.setLabelLinksEnabled(labelLinks);
      for (const l of labelLinks) {
        expect(!l.classList.contains('disabled'));
      }
    });
  });
  describe('filterLabelsList', () => {
    it('hides labels that do not match the search input value', () => {
      (document.querySelector('#label-search') as HTMLInputElement).value = 'blu';
      Labels.filterLabelsList();
      const labelsListElement = document.getElementById('labels-list');
      const blueLi = labelsListElement.querySelector('a[name="blue"]').closest('li');
      const greenLi = labelsListElement.querySelector('a[name="green"]').closest('li');
      const yellowLi = labelsListElement.querySelector('a[name="yellow"]').closest('li');
      expect(blueLi.style.display).to.not.equal('none');
      expect(greenLi.style.display).to.equal('none');
      expect(yellowLi.style.display).to.equal('none');
    });
    it('shows a no matches list item when the search input value does not match any labels', () => {
      (document.querySelector('#label-search') as HTMLInputElement).value = 'bluez';
      Labels.filterLabelsList();
      const labelsListElement = document.getElementById('labels-list');
      const blueLi = labelsListElement.querySelector('a[name="blue"]').closest('li');
      const greenLi = labelsListElement.querySelector('a[name="green"]').closest('li');
      const yellowLi = labelsListElement.querySelector('a[name="yellow"]').closest('li');
      const noMatchLi = document.getElementById('no-match-li');
      expect(blueLi.style.display).to.equal('none');
      expect(greenLi.style.display).to.equal('none');
      expect(yellowLi.style.display).to.equal('none');
      expect(noMatchLi.style.display).to.not.equal('none');
    });
  });
  describe('showAllLabels', () => {
    it('unhides all labels', () => {
      (document.querySelector('#label-search') as HTMLInputElement).value = 'bluez';
      Labels.filterLabelsList();
      Labels.showAllLabels();
      const labelItems = document.querySelectorAll('#labels-list .label-li');
      for (const labelItem of labelItems) {
        expect((labelItem as HTMLInputElement).style.display).to.equal('');
      }
    });
  });
});
