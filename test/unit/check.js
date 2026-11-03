var Check = require('../../models/check');
var PollerCollection = require('../../lib/pollers/pollerCollection');
var assert = require('assert');


describe('populateFromDirtyCheck', function() {

  var checkWithName, checkWithoutName, pollerCollection; // fixtures

  before(function() {
    pollerCollection = new PollerCollection();
  });

  beforeEach(function() {
    checkWithName = new Check();
    checkWithName.url = 'http://www.url1.fr';
    checkWithName.name = 'name1';
    checkWithName.isPaused = false;

    checkWithoutName = new Check();
    checkWithoutName.url = 'http://www.url2.fr';
    checkWithoutName.isPaused = false;
  });

  it('should update object', function() {
    checkWithName.populateFromDirtyCheck({url:'http://www.new-url.fr', name:'new-name'}, pollerCollection);
    assert.equal(checkWithName.name, 'new-name');
    assert.equal(checkWithName.url, 'http://www.new-url.fr');
  });

  it('should not erase empty values', function() {
    checkWithName.populateFromDirtyCheck({url:'http://www.new-url.fr'}, pollerCollection);
    assert.equal(checkWithName.name, 'name1');
    assert.equal(checkWithName.url, 'http://www.new-url.fr');
  });

  it('should use given url as name if check has no name and no name is given', function() {
    checkWithoutName.populateFromDirtyCheck({url:'http://www.new-url.fr'}, pollerCollection);
    assert.equal(checkWithoutName.name, 'http://www.new-url.fr');
    assert.equal(checkWithoutName.url, 'http://www.new-url.fr');
  });

  it('should use given url as name if check has no name and given name is empty', function() {
    checkWithoutName.populateFromDirtyCheck({url:'http://www.new-url.fr', name:''}, pollerCollection);
    assert.equal(checkWithoutName.name, 'http://www.new-url.fr');
    assert.equal(checkWithoutName.url, 'http://www.new-url.fr');
  });

  it('should not use given url if check has name and no name is given', function() {
    checkWithName.populateFromDirtyCheck({url:'http://www.new-url.fr'}, pollerCollection);
    assert.equal(checkWithName.name, 'name1');
    assert.equal(checkWithName.url, 'http://www.new-url.fr');
  });

  it('should use given name if check has no name name is given', function() {
    checkWithoutName.populateFromDirtyCheck({name:'new-name'}, pollerCollection);
    assert.equal(checkWithoutName.name, 'new-name');
    assert.equal(checkWithoutName.url, 'http://www.url2.fr');
  });

  it('should guess the poller type from the url', function() {
    checkWithName.populateFromDirtyCheck({url:'https://www.new-url.fr'}, pollerCollection);
    assert.equal(checkWithName.type, 'https');
    checkWithName.populateFromDirtyCheck({url:'udp://127.0.0.1:1234'}, pollerCollection);
    assert.equal(checkWithName.type, 'udp');
  });

  it('should use the given poller type if it matches the url', function() {
    checkWithName.populateFromDirtyCheck({url:'http://www.new-url.fr', type:'webpagetest'}, pollerCollection);
    assert.equal(checkWithName.type, 'webpagetest');
  });

  it('should throw an error if the poller type does not match the url', function() {
    assert.throws(function() {
      checkWithName.populateFromDirtyCheck({url:'http://www.new-url.fr', type:'https'}, pollerCollection);
    }, /mismatch/);
  });

  it('should throw an error if the poller type cannot be guessed from the url', function() {
    assert.throws(function() {
      checkWithName.populateFromDirtyCheck({url:'ftp://www.new-url.fr'}, pollerCollection);
    }, /Unable to determine poller type/);
  });

  it('should throw an error if there is no url', function() {
    assert.throws(function() {
      new Check().populateFromDirtyCheck({name:'new-name'}, pollerCollection);
    }, /URL must be defined/);
  });

  it('should convert the interval from seconds to milliseconds', function() {
    checkWithName.populateFromDirtyCheck({interval:'30'}, pollerCollection);
    assert.equal(checkWithName.interval, 30000);
    checkWithName.populateFromDirtyCheck({}, pollerCollection);
    assert.equal(checkWithName.interval, 30000);
  });

  it('should convert the tags from a comma separated string', function() {
    checkWithName.populateFromDirtyCheck({tags:'foo, bar'}, pollerCollection);
    assert.deepEqual(checkWithName.tags.toObject(), ['foo', 'bar']);
  });

});
