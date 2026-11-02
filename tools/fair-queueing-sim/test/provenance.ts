import { expect } from 'chai';
import { describe, it } from 'mocha';

import { describeCode, gitState, policyFiles, resultCodeHash } from '../src/provenance';

describe('provenance', function () {
  describe('describeCode', function () {
    const clean = { commit: '0123456789abcdef0123456789abcdef01234567', branch: 'main', dirty: false, changedFiles: [], changesHash: null };

    it('names the commit and branch', function () {
      expect(describeCode(clean)).to.equal('012345678 (main)');
    });

    it('says when there are uncommitted changes', function () {
      expect(describeCode({ ...clean, dirty: true, changedFiles: ['a', 'b'], changesHash: 'abc123' }))
        .to.equal('012345678 (main) + uncommitted changes abc123 to 2 file(s)');
    });

    it('says when it isn\'t a git checkout', function () {
      expect(describeCode({ commit: null, branch: null, dirty: null, changedFiles: [], changesHash: null }))
        .to.equal('unknown (not a git checkout)');
    });
  });

  describe('gitState', function () {
    it('describes this checkout', function () {
      const state = gitState();
      expect(state.commit).to.match(/^[0-9a-f]{40}$/);
      expect(state.dirty).to.equal(state.changedFiles.length > 0);
      expect(state.changesHash === null).to.equal(!state.dirty);
    });
  });

  describe('policyFiles', function () {
    it('is empty for policies implemented in Harmony itself', function () {
      expect(policyFiles('slot-based')).to.deep.equal([]);
      expect(policyFiles('duration-based')).to.deep.equal([]);
    });
  });

  describe('resultCodeHash', function () {
    this.timeout(10_000);

    it('is a short hex hash that stays the same while the code does', function () {
      const hash = resultCodeHash('slot-based');
      expect(hash).to.match(/^[0-9a-f]{16}$/);
      expect(resultCodeHash('slot-based')).to.equal(hash);
    });

    it('is the same for policies with no files of their own', function () {
      expect(resultCodeHash('duration-based')).to.equal(resultCodeHash('slot-based'));
    });
  });
});
