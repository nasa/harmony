process.env.NODE_ENV = 'test';

const { before } = require('mocha');
const sinon = require('sinon');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const env = require('../../app/util/env');

chai.use(chaiAsPromised);

before(() => {
  sinon.stub(env, 'harmonyClientId').get(() => 'harmony-test');
});
