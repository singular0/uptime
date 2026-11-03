const should = require('should');
const mongoose = require('../../bootstrap');
const Tag = require('../../models/tag');

describe('lifecycle events plugin', function() {

  const eventNames = ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate', 'beforeSave', 'afterSave', 'beforeRemove', 'afterRemove'];
  let events, listeners;

  before(function() {
    return Tag.collection.deleteMany({});
  });

  beforeEach(function() {
    events = [];
    listeners = {};
    eventNames.forEach(function(name) {
      listeners[name] = function(doc) { events.push(name + ':' + doc.name); };
      Tag.on(name, listeners[name]);
    });
  });

  afterEach(function() {
    eventNames.forEach(function(name) {
      Tag.removeListener(name, listeners[name]);
    });
  });

  after(function() {
    return Tag.collection.deleteMany({});
  });

  it('should emit insert and save events when a document is created', async function() {
    await new Tag({ name: 'lifecycle' }).save();
    events.should.eql(['beforeSave:lifecycle', 'beforeInsert:lifecycle', 'afterSave:lifecycle', 'afterInsert:lifecycle']);
  });

  it('should emit update and save events when a document is updated', async function() {
    const tag = await Tag.findOne({ name: 'lifecycle' });
    tag.count = 2;
    await tag.save();
    events.should.eql(['beforeSave:lifecycle', 'beforeUpdate:lifecycle', 'afterSave:lifecycle', 'afterUpdate:lifecycle']);
  });

  it('should emit remove events when a document is deleted', async function() {
    const tag = await Tag.findOne({ name: 'lifecycle' });
    await tag.deleteOne();
    events.should.eql(['beforeRemove:lifecycle', 'afterRemove:lifecycle']);
  });

});
