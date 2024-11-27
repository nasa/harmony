import { AsyncLocalStorage } from 'node:async_hooks';
import RequestContext from '../models/request-context';

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
