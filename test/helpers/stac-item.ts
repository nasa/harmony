/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { cloneDeep } from 'lodash';
import { it } from 'mocha';

/**
 * Test that the `asset` entry contains the expected link types
 *
 * @param assetsEntry - an `assets` entry from a STAC item
 * @param linkType - the expected link type - http|https|s3
 */
function expectAssets(assetsEntry: any, linkType?: string): void {
  let expectedType: string;
  switch (linkType) {
    case 'https':
    case 'http':
      expectedType = 'http';
      break;
    default:
      expectedType = 's3';
  }
  const link = Object.keys(assetsEntry)[0];
  expect(link.toLowerCase().startsWith(expectedType)).to.be.true;
  expect(assetsEntry[link].href).to.equal(link);
}

/**
 * Parameterized tests for STAC item contents
 *
 * @param item - a STAC item
 */
export default function itReturnsTheExpectedStacResponse(
  completedJob: any,
  expectedItemWithoutAssets,
  linkType?: string,
): void {
  it('returns an HTTP OK response', function () {
    expect(this.res.statusCode).to.equal(200);
  });

  it(`returns a STAC catalog in JSON format with an ${linkType} asset`, function () {
    const item = JSON.parse(this.res.text);
    const itemWithoutAssets = cloneDeep(item);
    delete itemWithoutAssets.assets;
    const { assets } = item;
    const tmpExpectedItemWithoutAssets = cloneDeep(expectedItemWithoutAssets);
    const url = linkType ? `../?linkType=${linkType}` : '../';
    tmpExpectedItemWithoutAssets.links = [
      { href: url, rel: 'self', title: 'self' },
      { href: url, rel: 'root', title: 'parent' },
    ];
    tmpExpectedItemWithoutAssets.properties.created = itemWithoutAssets.properties.created;
    expect(itemWithoutAssets).to.eql(tmpExpectedItemWithoutAssets);

    expectAssets(assets, linkType);
  });
}
