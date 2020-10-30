import { hookMockS3 } from './object-store';

hookMockS3();

process.env.REPLAY = process.env.REPLAY || 'record';
require('replay');
