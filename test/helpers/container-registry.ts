import sinon, { SinonStub } from 'sinon';
import { ECR, ImageDetails } from 'util/container-registry';

/**
 * Adds before and after hooks to the ECR describe image call.
 * @param imageResponse The response to return from all ECR describe images calls.
 *
 */
export default function hookDescribeImage(imageResponse: ImageDetails): void {
  before(function () {
    sinon.stub(ECR.prototype, 'describeImage')
      .resolves(imageResponse);
  });
  after(function () {
    (ECR.prototype.describeImage as SinonStub).restore();
  });
}
