const should = require('should');
const flash = require('../../lib/flash');

describe('flash', function() {

  let req;

  beforeEach(function(done) {
    req = { session: {} };
    flash()(req, {}, done);
  });

  it('should return and clear the messages of a type', function() {
    req.flash('info', 'Check saved').should.eql(1);
    req.flash('info', ['Check paused', 'Check restarted']).should.eql(3);
    req.flash('error', 'Oops');
    req.flash('info').should.eql(['Check saved', 'Check paused', 'Check restarted']);
    req.flash('info').should.eql([]);
    req.flash('error').should.eql(['Oops']);
  });

  it('should format the message with extra arguments', function() {
    req.flash('info', 'Check %s saved in %dms', 'foo', 12);
    req.flash('info').should.eql(['Check foo saved in 12ms']);
  });

  it('should return and clear all messages', function() {
    req.flash('info', 'Check saved');
    req.flash('error', 'Oops');
    req.flash().should.eql({ info: ['Check saved'], error: ['Oops'] });
    req.flash().should.eql({});
  });

  it('should require a session', function() {
    delete req.session;
    (function() { req.flash('info', 'Check saved'); }).should.throw('req.flash() requires sessions');
  });

});
