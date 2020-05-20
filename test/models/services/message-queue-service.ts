import { describe, it } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import hookServersStartStop from 'harmony-test/servers';
import { rangesetRequest, defaultVersion } from 'harmony-test/ogc-api-coverages';
import aws from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

describe('Message Queue Service', function () {
  const mqCollection = 'C1234088182-EEDTEST'; // Harmony Example L3 v2 in UAT
  hookServersStartStop();

  it('passes the incoming messages to the a configured message queue', async function () {
    // Mock the message queue
    const sendMessageStub = sinon.stub().returns(Promise.resolve(null));
    AWSMock.setSDKInstance(aws);
    AWSMock.mock('SQS', 'sendMessage', sendMessageStub);
    await rangesetRequest(this.frontend, defaultVersion, mqCollection);

    // Assert it resulted in a single message to SQS that contains the collection we requested
    expect(sendMessageStub.calledOnce).to.be.true;

    const arg = sendMessageStub.firstCall.args[0];
    expect(arg.QueueUrl).to.equal('http://localhost:4576/queue/harmony-gdal-queue');

    const message = JSON.parse(arg.MessageBody);
    expect(message.sources[0].collection).to.equal(mqCollection);
  });
});
