/**
 * The purpose of this file is to override any interaction with AWS
 * for tests. It is referenced in the .mocharc.yml file to ensure it
 * stubs out interactions for all tests before they begin.
 */
import { hookMockS3 } from './object-store';
import hookShapefileUpload from './shapefile-upload';

hookMockS3();
hookShapefileUpload();