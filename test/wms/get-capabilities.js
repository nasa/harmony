const { describe, it, xit } = require('mocha');
const { expect } = require('chai');
const { hookServersStartStop } = require('../helpers/servers');
const { hookGetCapabilities } = require('../helpers/wms');

describe('WMS GetCapabilities', function () {
  hookServersStartStop();

  describe('when called on a collection with variable metadata', function () {
    const collection = 'C1215669046-GES_DISC';
    const variable1 = 'V1224729877-GES_DISC';
    const variable2 = 'V1224729868-GES_DISC';

    hookGetCapabilities(collection);

    it('completes successfully', function () {
      expect(this.res.status).to.equal(200);
    });

    it('returns the variables as layers in the capabilities response', function () {
      // Multiple variables, named as layers
      expect(this.res.text).to.contain(`<Name>${collection}&#x2F;${variable1}</Name>`);
      expect(this.res.text).to.contain(`<Name>${collection}&#x2F;${variable2}</Name>`);
    });

    it('does not expose the entire collection as an available layer', function () {
      // No named collection-level layer
      expect(this.res.text).to.not.contain(`<Name>${collection}</Name>`);
    });
  });

  describe('when called on a collection without variable metadata', function () {
    // Checks below are marked as broken because this collection now contains variables.
    // With HARMONY-124 we will find a new collection without associated variable metadata
    // to use for this test.
    const collection = 'C1225996408-POCUMULUS';

    hookGetCapabilities(collection);

    it('completes successfully', function () {
      expect(this.res.status).to.equal(200);
    });

    // Re-enable with HARMONY-124
    xit('returns a single layer for the entire collection in the capabilities response', function () {
      expect(this.res.text).to.contain(`<Name>${collection}</Name>`);
    });

    // Re-enable with HARMONY-124
    xit('does not return any variable layers', function () {
      expect(this.res.text).to.not.contain(`<Name>${collection}&#x2F;`);
    });
  });
});
