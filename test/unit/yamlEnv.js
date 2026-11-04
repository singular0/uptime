const should = require('should');
const path = require('path');
const { execFileSync } = require('child_process');
const yamlEnv = require('../../lib/yamlEnv');

describe('yamlEnv', function() {

  const env = { HOST: 'example.com', PORT: '8080', FALSE: 'false', EMPTY: '', SECRET: '0123', TRICKY: 'a: b # c ${HOST}' };
  const parse = function(content) {
    return yamlEnv.parse('test.yaml', content, env);
  };

  describe('parse()', function() {

    it('should expand environment variables in the values', function() {
      parse('url: http://${HOST}:${PORT}/api').should.eql({ url: 'http://example.com:8080/api' });
      parse('a:\n  b: [x, "${HOST}"]').should.eql({ a: { b: ['x', 'example.com'] } });
      parse('text: |\n  host ${HOST}\n').should.eql({ text: 'host example.com\n' });
    });

    it('should not expand environment variables in the keys', function() {
      parse('${HOST}: 1').should.eql({ '${HOST}': 1 });
    });

    it('should give an unquoted value the type it would have if it was written in the file', function() {
      parse('port: ${PORT}').should.eql({ port: 8080 });
      parse('enabled: ${FALSE}').should.eql({ enabled: false });
      parse('password: ${EMPTY}').should.eql({ password: null });
      parse('secret: ${SECRET}').should.eql({ secret: 123 });
      parse('timeout: ${PORT}0').should.eql({ timeout: 80800 });
    });

    it('should keep a quoted value or a tagged value as a string', function() {
      parse("port: '${PORT}'").should.eql({ port: '8080' });
      parse('enabled: "${FALSE}"').should.eql({ enabled: 'false' });
      parse("secret: '${SECRET}'").should.eql({ secret: '0123' });
      parse('secret: !!str ${SECRET}').should.eql({ secret: '0123' });
      parse('password: "${EMPTY}"').should.eql({ password: '' });
    });

    it('should not parse an environment variable value as YAML', function() {
      parse('value: ${TRICKY}').should.eql({ value: 'a: b # c ${HOST}' });
      parse("value: '${TRICKY}'").should.eql({ value: 'a: b # c ${HOST}' });
    });

    it('should use the default value of ${VAR:-default} when the variable is not set or empty', function() {
      parse('host: ${HOST:-localhost}').should.eql({ host: 'example.com' });
      parse('host: ${MISSING:-localhost}').should.eql({ host: 'localhost' });
      parse('host: ${EMPTY:-localhost}').should.eql({ host: 'localhost' });
      parse('timeout: ${MISSING:-5000}').should.eql({ timeout: 5000 });
      parse('host: ${MISSING:-}').should.eql({ host: null });
    });

    it('should fail when a variable without a default value is not set', function() {
      (function() { parse('password: ${MISSING}'); }).should.throw(/Environment variable MISSING is not set/);
    });

    it('should fail on an invalid reference', function() {
      (function() { parse('host: ${HOST NAME}'); }).should.throw(/Invalid environment variable reference \$\{HOST NAME\}/);
    });

    it('should turn $${VAR} into the literal ${VAR}', function() {
      parse('text: $${HOST} is ${HOST}').should.eql({ text: '${HOST} is example.com' });
    });

    it('should expand the anchored values that aliases refer to', function() {
      parse('a: &host ${HOST}\nb: *host').should.eql({ a: 'example.com', b: 'example.com' });
    });

    it('should support merge keys', function() {
      parse('base: &base\n  a: 1\nchild:\n  <<: *base\n  b: 2').child.should.eql({ a: 1, b: 2 });
    });

    it('should fail on invalid YAML', function() {
      (function() { parse('a: [1'); }).should.throw();
    });

  });

  describe('lib/config', function() {

    it('should expand the environment variables in the config files', function() {
      const root = path.join(__dirname, '../..');
      const script = "console.log(JSON.stringify(require('./lib/config').get('mongodb')))";
      const output = execFileSync(process.execPath, ['-e', script], {
        cwd: root,
        env: Object.assign({}, process.env, {
          NODE_ENV: 'test',
          NODE_CONFIG_DIR: path.join(__dirname, 'yamlEnv'),
          UPTIME_TEST_DB: 'from-env'
        })
      });
      JSON.parse(output).should.eql({ database: 'from-env', port: 27017 });
    });

  });

});
