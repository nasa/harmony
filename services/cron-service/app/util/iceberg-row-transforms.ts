/* eslint-disable @typescript-eslint/no-explicit-any */
export const tableRowTransforms = {
  'workflow_steps': (row: any): void => {
    // remove the access token from the operation
 
    // eslint-disable-next-line @typescript-eslint/dot-notation
    const operationStr = row['operation'];
    const operation = JSON.parse(operationStr);
    delete operation.accessToken;
    // eslint-disable-next-line @typescript-eslint/dot-notation
    row['operation'] = JSON.stringify(operation);
  }
};