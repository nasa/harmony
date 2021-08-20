import * as fs from 'fs';
import * as util from 'util';

export const unlink = util.promisify(fs.unlink);
export const readFile = util.promisify(fs.readFile);
export const writeFile = util.promisify(fs.writeFile);
export const rmdir = util.promisify(fs.rmdir);
