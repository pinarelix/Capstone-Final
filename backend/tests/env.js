// Loaded by Jest (setupFiles) BEFORE any test file requires server.js.
// dotenv.config() (called inside server.js) does not override
// already-set process.env values, so setting DB_NAME here first makes
// every test run against brgydata_test instead of the real database —
// same mechanism already relied on elsewhere in this codebase.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.DB_NAME = 'brgydata_test';
