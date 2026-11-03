// Force the test configuration (config/test.yaml) before any module loads node-config,
// so the suites never run against the development database.
process.env.NODE_ENV = 'test';
