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
function testAssets(assetsEntry: any, linkType: string): void {
  const expectedType = linkType === 'https' ? 'http' : linkType;
  const link = Object.keys(assetsEntry)[0];
  expect(link.toLowerCase().startsWith(expectedType)).to.be.true;
  expect(assetsEntry[link].href).to.equal(link);
}

/**
 * Parameterized tests for STAC item contents
 *
 * @param item - a STAC item
 */
export default function stacItemAssetTest(
  completedJob: any,
  expectedItemWithoutAssets,
  linkType: string,
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
    tmpExpectedItemWithoutAssets.properties.created = itemWithoutAssets.properties.created;
    expect(itemWithoutAssets).to.eql(tmpExpectedItemWithoutAssets);

    testAssets(assets, linkType);
  });
}
