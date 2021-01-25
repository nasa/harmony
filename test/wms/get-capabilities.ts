import { describe, it, xit } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from '../helpers/servers';
import { hookGetCapabilities } from '../helpers/wms';
import { describeErrorCondition } from '../helpers/errors';

describe('WMS GetCapabilities', function () {
  hookServersStartStop();

  describe('when called on a collection with variable metadata', function () {
    const collection = 'C1233800302-EEDTEST';
    const variable1 = 'V1233801695-EEDTEST';
    const variable2 = 'V1233801716-EEDTEST';

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

    // Re-enable with HARMONY-124
    xit('completes successfully', function () {
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

  const unsupportedCollection = 'C446474-ORNL_DAAC';
  describeErrorCondition({
    condition: 'collection that does not have any supported services',
    path: `/${unsupportedCollection}/wms?service=WMS&request=GetCapabilities`,
    message: 'There is no service configured to support transformations on the provided collection via WMS.',
  });
});
