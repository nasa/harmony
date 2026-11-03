import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { NATIVE_POLICY, POLICY_CATALOG, POLICY_NAMES, resolvedSettings } from '../src/policies/catalog';

const WORK_SCHEDULER_ENV_DEFAULTS = path.resolve(__dirname, '..', '..', '..', 'services', 'work-scheduler', 'env-defaults');

describe('policy catalog', function () {
  it('has Harmony\'s two policies, and adaptive-fast-lane', function () {
    expect(POLICY_NAMES).to.deep.equal(['slot-based', 'duration-based', 'adaptive-fast-lane']);
    expect(POLICY_NAMES).to.not.include(NATIVE_POLICY);
  });

  it('describes how to make adaptive-fast-lane duration-based, using only its own settings', function () {
    const { equivalentTo, settings } = POLICY_CATALOG['adaptive-fast-lane'];
    expect(equivalentTo.policy).to.equal('duration-based');
    const own = settings.map((s) => s.env);
    for (const key of Object.keys(equivalentTo.set)) expect(own, key).to.include(key);
  });

  it('switches off one of adaptive-fast-lane\'s own settings in each variant', function () {
    const own = POLICY_CATALOG['adaptive-fast-lane'].settings.map((s) => s.env);
    for (const variant of POLICY_CATALOG['adaptive-fast-lane'].variants) {
      expect(Object.keys(variant.set), variant.name).to.have.lengthOf(1);
      expect(own, variant.name).to.include(Object.keys(variant.set)[0]);
    }
  });

  it('describes every policy', function () {
    for (const name of POLICY_NAMES) {
      expect(POLICY_CATALOG[name].description, name).to.not.be.empty;
    }
  });

  it('takes duration-based\'s defaults from the work-scheduler\'s env-defaults', function () {
    const defaults = fs.readFileSync(WORK_SCHEDULER_ENV_DEFAULTS, 'utf8');
    for (const setting of POLICY_CATALOG['duration-based'].settings) {
      expect(defaults, setting.env).to.match(new RegExp(`^${setting.env}=${setting.default}$`, 'm'));
    }
  });

  describe('resolvedSettings', function () {
    it('uses the defaults when nothing is set', function () {
      expect(resolvedSettings('duration-based', {})).to.deep.equal(Object.fromEntries(
        POLICY_CATALOG['duration-based'].settings.map((s) => [s.env, s.default])));
    });

    it('uses values from the environment when they are set', function () {
      expect(resolvedSettings('duration-based', { SLOW_WORK_THRESHOLD_MS: '300000' }).SLOW_WORK_THRESHOLD_MS).to.equal('300000');
    });

    it('is empty for a policy with no settings, or an unknown one', function () {
      expect(resolvedSettings('slot-based', {})).to.deep.equal({});
      expect(resolvedSettings('no-such-policy', {})).to.deep.equal({});
    });
  });
});
