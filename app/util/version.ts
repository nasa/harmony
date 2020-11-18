import fs from 'fs';
import path from 'path';

const packageBuf = fs.readFileSync(path.join(__dirname, '../../package.json'));
const { version } = JSON.parse(packageBuf.toString('utf-8'));

// HARMONY-619 will add proper versioning
export default version;
