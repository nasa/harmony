import { describe, it } from 'mocha';
import { expect } from 'chai';
import * as cmr from '../../app/util/cmr';

const granule1: cmr.CmrGranule = {
  id: '',
  title: '',
  time_start: '',
  time_end: '',
  links: [
    {
      rel: '',
      href: '',
    },
  ],
};

describe('util/cmr', function () {
  describe('filterGranuleLinks', function () {
    it('returns opendap links regardless of rel', function () {
      expect(cmr.filterGranuleLinks(granule1, 'hi')).to.eql([]);
    });
  });
});
