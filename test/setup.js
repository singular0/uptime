// Force the test configuration (config/test.yaml) before any module loads node-config,
// so the suites never run against the development database.
process.env.NODE_ENV = 'test';
// The tests only talk to local servers, which must not go through a proxy (see lib/proxy.js).
delete process.env.http_proxy;
delete process.env.https_proxy;
