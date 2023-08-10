process.env.NODE_ENV = 'test';
// work-around to pass check in app/util/env.ts - should be refactored
process.env.SHARED_SECRET_KEY = 'foo';
process.env.PORT = '5000';
// We do not use an EDL application or call backend services in our tests.
process.env.COOKIE_SECRET = 'foo';
process.env.OAUTH_CLIENT_ID = 'foo';
process.env.OAUTH_UID = 'foo';
process.env.OAUTH_PASSWORD = 'foo';
process.env.SHARED_SECRET_KEY = 'foo';
