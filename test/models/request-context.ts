import { expect } from 'chai';
import { describe, it } from 'mocha';
import RequestContext from '../../app/models/request-context';

describe('RequestContext', function () {
  const context = new RequestContext('1');
  describe('setting id', function () {
    context.id = '2';
    it('is allowed', function () {
      expect(context.id).to.equal('2');
    });
  });
  describe('setting frontend', function () {
    context.frontend = 'wms';
    it('is allowed', function () {
      expect(context.frontend).to.equal('wms');
    });
  });
  describe('setting logger', function () {
    context.logger = 'logger';
    it('is allowed', function () {
      expect(context.logger).to.equal('logger');
    });
  });
  describe('setting requestedMimeTypes', function () {
    context.requestedMimeTypes = ['application/json', 'image/tiff'];
    it('is allowed', function () {
      expect(context.requestedMimeTypes).to.eql(['application/json', 'image/tiff']);
    });
  });
  // These tests is deprecated since TypeScript ensures that we can't add properties
  // to a non-extensible object
  // describe('setting a property that is not part of the model', function () {
  //   context.foo = 'bar';
  //   it('ignores the field', function () {
  //     expect(context.foo).to.be.undefined;
  //   });
  // });
  // describe('setting a property on the model that is not part of the model', function () {
  //   context.model.alpha = 'omega';
  //   it('ignores the field', function () {
  //     expect(context.model.alpha).to.be.undefined;
  //   });
  // });
});
