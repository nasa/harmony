process.env.NODE_ENV = 'test';
// work-around to pass check in app/util/env.ts - should be refactored
process.env.SHARED_SECRET_KEY = 'foo';
process.env.PORT = '5000';