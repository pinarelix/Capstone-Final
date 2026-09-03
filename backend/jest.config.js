module.exports = {
    testEnvironment: 'node',
    globalSetup: './tests/globalSetup.js',
    globalTeardown: './tests/globalTeardown.js',
    setupFiles: ['./tests/env.js'],
    testTimeout: 15000,
    testMatch: ['**/tests/**/*.test.js']
};
