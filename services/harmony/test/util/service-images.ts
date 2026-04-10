import { expect } from 'chai';

import { _getImageToServiceMap, getServiceName } from '../../app/util/service-images';

describe('envVarToServiceName (via _getImageToServiceMap)', () => {
  it('converts PODAAC_L2_SUBSETTER_IMAGE → podaac-l2-subsetter', () => {
    const env = { PODAAC_L2_SUBSETTER_IMAGE: 'ghcr.io/podaac/l2ss-py:sit' };
    const services = new Set(['podaac-l2-subsetter']);
    const map = _getImageToServiceMap(env, services);
    expect(Object.values(map)).to.include('podaac-l2-subsetter');
  });

  it('converts QUERY_CMR_IMAGE to query-cmr', () => {
    const env = { QUERY_CMR_IMAGE: 'harmonyservices/query-cmr:latest' };
    const services = new Set(['query-cmr']);
    const map = _getImageToServiceMap(env, services);
    expect(Object.values(map)).to.include('query-cmr');
  });

  it('converts HARMONY_MASKFILL_IMAGE to harmony-maskfill', () => {
    const env = { HARMONY_MASKFILL_IMAGE: '1234567.dkr.ecr.us-west-2.amazonaws.com/nasa/harmony-maskfill:latest' };
    const services = new Set(['harmony-maskfill']);
    const map = _getImageToServiceMap(env, services);
    expect(Object.values(map)).to.include('harmony-maskfill');
  });
});

describe('getImageToServiceMap', () => {
  it('maps a single deployed ghcr image correctly', () => {
    const env = { HARMONY_MASKFILL_IMAGE: 'ghcr.io/nasa/harmony-maskfill:latest' };
    const services = new Set(['harmony-maskfill']);
    const map = _getImageToServiceMap(env, services);

    // sanitizeImage strips the registry; key is the repo path without the tag
    expect(map).to.deep.equal({ 'nasa/harmony-maskfill': 'harmony-maskfill' });
  });

  it('maps multiple deployed services', () => {
    const env = {
      L2SS_PY_IMAGE: 'ghcr.io/podaac/l2ss-py:sit',
      CONCISE_IMAGE: 'ghcr.io/podaac/concise:sit',
    };
    const services = new Set(['l2ss-py', 'concise']);
    const map = _getImageToServiceMap(env, services);

    expect(map).to.deep.equal({
      'podaac/l2ss-py': 'l2ss-py',
      'podaac/concise': 'concise',
    });
  });

  it('excludes services absent from the deployed set', () => {
    const env = {
      HARMONY_MASKFILL_IMAGE: 'ghcr.io/nasa/harmony-maskfill:latest',
      NET2COG_IMAGE: 'ghcr.io/podaac/net2cog:sit',
    };
    const services = new Set(['harmony-maskfill']); // net2cog deliberately omitted
    const map = _getImageToServiceMap(env, services);

    expect(Object.values(map)).to.include('harmony-maskfill');
    expect(Object.values(map)).not.to.include('net2cog');
  });

  it('strips the image tag — only the base name becomes the map key', () => {
    const env = { STITCHEE_IMAGE: 'ghcr.io/nasa/stitchee:1.9.0' };
    const services = new Set(['stitchee']);
    const map = _getImageToServiceMap(env, services);

    expect(map).to.have.key('nasa/stitchee');
    expect(map).not.to.have.key('nasa/stitchee:1.9.0');
  });

  it('strips an ECR registry via sanitizeImage', () => {
    const ecrImage = '1234567.dkr.ecr.us-west-2.amazonaws.com/ldds/subset-band-name:2.0.0';
    const env = { LDDS_SUBSET_BAND_NAME_IMAGE: ecrImage };
    const services = new Set(['ldds-subset-band-name']);
    const map = _getImageToServiceMap(env, services);

    // sanitizeImage strips the ECR host; the key becomes the repo path
    expect(map).to.have.key('ldds/subset-band-name');
  });

  it('ignores env keys that do not end with _IMAGE', () => {
    const env = {
      HARMONY_MASKFILL_TAG: 'ghcr.io/nasa/harmony-maskfill:latest',
      SOME_RANDOM_VAR: 'some-value',
    };
    const services = new Set(['harmony-maskfill']);
    const map = _getImageToServiceMap(env, services);

    expect(map).to.deep.equal({});
  });

  it('ignores _IMAGE keys whose value is an empty string', () => {
    const env = { HARMONY_MASKFILL_IMAGE: '' };
    const services = new Set(['harmony-maskfill']);
    const map = _getImageToServiceMap(env, services);

    expect(map).to.deep.equal({});
  });

  it('ignores _IMAGE keys whose value is undefined', () => {
    const env: NodeJS.ProcessEnv = { HARMONY_MASKFILL_IMAGE: undefined };
    const services = new Set(['harmony-maskfill']);
    const map = _getImageToServiceMap(env, services);

    expect(map).to.deep.equal({});
  });

  it('returns an empty map when the environment has no _IMAGE keys', () => {
    const map = _getImageToServiceMap({}, new Set(['harmony-maskfill']));
    expect(map).to.deep.equal({});
  });

  it('returns an empty map when the deployed services set is empty', () => {
    const env = { HARMONY_MASKFILL_IMAGE: 'ghcr.io/nasa/harmony-maskfill:latest' };
    const map = _getImageToServiceMap(env, new Set());
    expect(map).to.deep.equal({});
  });

  it('handles an image with no tag (no colon) without throwing', () => {
    const env = { HARMONY_MASKFILL_IMAGE: 'ghcr.io/nasa/harmony-maskfill' };
    const services = new Set(['harmony-maskfill']);
    expect(() => _getImageToServiceMap(env, services)).not.to.throw();
  });
});

describe('getServiceName', () => {
  const imageToServiceMap = {
    'nasa/harmony-maskfill': 'harmony-maskfill',
    'nasa/stitchee': 'stitchee',
    'podaac/l2ss-py': 'l2ss-py',
    'harmonyservices/query-cmr': 'query-cmr',
    'ldds/subset-band-name': 'ldds-subset-band-name',
    'nasa/harmony-swath-projector': 'harmony-swath-projector',
  };

  it('returns the mapped service name for a known ghcr image', () => {
    expect(getServiceName(imageToServiceMap, 'ghcr.io/nasa/harmony-maskfill:latest'))
      .to.equal('harmony-maskfill');
  });

  it('resolves correctly regardless of image tag', () => {
    expect(getServiceName(imageToServiceMap, 'ghcr.io/nasa/stitchee:1.9.0'))
      .to.equal('stitchee');
    expect(getServiceName(imageToServiceMap, 'ghcr.io/nasa/stitchee:2.0.0'))
      .to.equal('stitchee');
  });

  it('returns query-cmr for the harmonyservices image', () => {
    expect(getServiceName(imageToServiceMap, 'harmonyservices/query-cmr:latest'))
      .to.equal('query-cmr');
  });

  it('returns the correct name for an ECR image', () => {
    expect(getServiceName(
      imageToServiceMap,
      '1234567.dkr.ecr.us-west-2.amazonaws.com/ldds/subset-band-name:2.0.0',
    )).to.equal('ldds-subset-band-name');
  });

  it('falls back to the sanitized base name when the image is not in the map', () => {
    expect(getServiceName(imageToServiceMap, 'ghcr.io/asfhyp3/nisar-py:latest'))
      .to.equal('asfhyp3/nisar-py');
  });

  it('falls back gracefully when the map is empty', () => {
    expect(getServiceName({}, 'ghcr.io/podaac/concise:sit'))
      .to.equal('podaac/concise');
  });

  it('handles an image with no tag without throwing', () => {
    expect(() => getServiceName(imageToServiceMap, 'ghcr.io/nasa/harmony-maskfill'))
      .not.to.throw();
  });
});
