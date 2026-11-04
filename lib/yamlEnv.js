/**
 * YAML parser that expands environment variables in the values (not the keys):
 *
 *   ${VAR}          the value of VAR, an error when VAR is not set
 *   ${VAR:-default} the value of VAR, or `default` when VAR is not set or empty
 *   $${VAR}         the literal text ${VAR}
 *
 * The expansion happens after parsing, so a value can't break the YAML syntax. An unquoted value
 * gets the type it would have if it was written in the file (`timeout: ${TIMEOUT}` is a number,
 * `autoStartMonitor: ${AUTO_START}` a boolean, and an empty value is null). A quoted value or a
 * block scalar always stays a string, so quote the secrets that could look like a number.
 */
const YAML = require('yaml');

const REFERENCE = /\$(\$?)\{([^}]*)\}/g;
const EXPRESSION = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/s;

const expand = function(value, env) {
  return value.replace(REFERENCE, function(reference, escape, expression) {
    if (escape) return reference.slice(1);
    const match = EXPRESSION.exec(expression);
    if (!match) throw new Error('Invalid environment variable reference ' + reference);
    const [, name, fallback] = match;
    const envValue = env[name];
    if (fallback !== undefined) return envValue ? envValue : fallback;
    if (envValue === undefined) throw new Error('Environment variable ' + name + ' is not set (used as ' + reference + ')');
    return envValue;
  });
};

// resolves a string like YAML resolves an untagged plain scalar (null, boolean, number or string)
const resolvePlain = function(value, doc) {
  const tag = doc.schema.tags.find(tag => tag.default === true && tag.test?.test(value));
  if (!tag) return value;
  const resolved = tag.resolve(value, function(message) { throw new Error(message); }, doc.options);
  return YAML.isScalar(resolved) ? resolved.value : resolved;
};

const parse = function(filename, content, env = process.env) {
  const doc = YAML.parseDocument(content, { merge: true }); // merge keys (<<), which js-yaml supported
  if (doc.errors.length) throw doc.errors[0];
  YAML.visit(doc, {
    Scalar: function(key, node) {
      if (key === 'key' || typeof node.value !== 'string' || !node.value.includes('${')) return;
      const value = expand(node.value, env);
      node.value = node.type === 'PLAIN' && !node.tag ? resolvePlain(value, doc) : value;
    }
  });
  return doc.toJS();
};

module.exports = { parse, expand };
