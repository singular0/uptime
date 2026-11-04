/**
 * node-config, with environment variables expanded in the YAML config files (see lib/yamlEnv.js).
 *
 * Require this module instead of 'config': node-config reads the files when it is first required,
 * so the parser has to be registered before. Plugins that require 'config' later get the same object.
 */
const parser  = require('config/parser').default;
const yamlEnv = require('./yamlEnv');

parser.setParser('yaml', yamlEnv.parse);
parser.setParser('yml', yamlEnv.parse);

module.exports = require('config');
