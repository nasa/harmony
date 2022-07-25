// Environment variables that are used by the query-cmr task
process.env.SHARED_SECRET_KEY = '_THIS_IS_MY_32_CHARS_SECRET_KEY_';
process.env.CMR_ENDPOINT = 'https://cmr.uat.earthdata.nasa.gov';
process.env.CMR_MAX_PAGE_SIZE = '2000';
process.env.STAGING_BUCKET = 'local_staging_bucket';
process.env.NODE_ENV = 'test';
