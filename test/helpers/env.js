process.env.NODE_ENV = 'test';

const { before } = require('mocha');
const sinon = require('sinon');
const env = require('../../app/util/env');

before(() => {
  sinon.stub(env, 'harmonyClientId').get(() => 'harmony-test');
});
