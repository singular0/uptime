/**
 * Email plugin
 *
 * Notifies all events (up, down, paused, restarted) by email
 *
 * Installation
 * ------------
 * This plugin is disabled by default. To enable it, add its entry 
 * to the `plugins` key of the configuration:
 *
 *   // in config/production.yaml
 *   plugins:
 *     - ./plugins/email
 *
 * Usage
 * -----
 * This plugin sends an email each time a check is started, goes down, or goes back up. 
 * When the check goes down, the email contains the error details:
 *
 *   Object: [Down] Check "FooBar" just went down
 *   On Thursday, September 4th 1986 8:30 PM,
 *   a test on URL "http://foobar.com" failed with the following error:
 *
 *     Error 500
 *
 *   Uptime won't send anymore emails about this check until it goes back up.
 *   ---------------------------------------------------------------------
 *   This is an automated email sent from Uptime. Please don't reply to it.
 *
 * Configuration
 * -------------
 * Here is an example configuration:
 *
 *   // in config/production.yaml
 *   email:
 *     method:      SMTP  # possible methods are SMTP, SES, or Sendmail
 *     transport:         # see https://nodemailer.com/smtp/ for transport options
 *       service:   Gmail
 *       auth:            
 *         user:    foobar@gmail.com
 *         pass:    gursikso
 *     event:
 *       up:        true
 *       down:      true
 *       paused:    false
 *       restarted: false
 *     message:           
 *       from:     'Fred Foo <foo@blurdybloop.com>'
 *       to:       'bar@blurdybloop.com, baz@blurdybloop.com'
 *     # The email plugin also uses the main `url` param for hyperlinks in the sent emails
 *
 * With the Sendmail method, `transport` holds the sendmail options (e.g. `path`),
 * see https://nodemailer.com/transports/sendmail/.
 *
 * The SES method requires the AWS SDK (`npm install @aws-sdk/client-sesv2`),
 * and `transport` holds the SESv2Client options (e.g. `region` and `credentials`),
 * see https://nodemailer.com/transports/ses/.
 */
var fs         = require('fs');
var nodemailer = require('nodemailer');
var moment     = require('moment');
var CheckEvent = require('../../models/checkEvent');
var ejs        = require('ejs');

var createMailer = function(config) {
  switch (String(config.method || 'SMTP').toUpperCase()) {
    case 'SENDMAIL':
      var sendmailOptions = typeof config.transport === 'string' ? { path: config.transport } : config.transport;
      return nodemailer.createTransport(Object.assign({ sendmail: true }, sendmailOptions));
    case 'SES':
      var ses = require('@aws-sdk/client-sesv2');
      return nodemailer.createTransport({
        SES: { sesClient: new ses.SESv2Client(config.transport || {}), SendEmailCommand: ses.SendEmailCommand }
      });
    default:
      return nodemailer.createTransport(config.transport);
  }
};

exports.initWebApp = function(options) {
  var config = options.config.email;
  var mailer = createMailer(config);
  var templateDir = __dirname + '/views/';
  CheckEvent.on('afterInsert', function(checkEvent) {
    if (!config.event[checkEvent.message]) return;
    checkEvent.findCheck().then(function(check) {
      var filename = templateDir + checkEvent.message + '.ejs';
      var data = {
        check: check,
        checkEvent: checkEvent,
        url: options.config.url,
        moment: moment
      };
      var lines = ejs.render(fs.readFileSync(filename, 'utf8'), data, { filename: filename }).split('\n');
      var mailOptions = {
        from:    config.message.from,
        to:      config.message.to,
        subject: lines.shift(),
        text:    lines.join('\n')
      };
      mailer.sendMail(mailOptions, function(err2, response) {
        if (err2) return console.error('Email plugin error: %s', err2);
        console.log('Notified event by email: Check ' + check.name + ' ' + checkEvent.message);
      });
    }).catch(function(err) { console.error(err); });
  });
  console.log('Enabled Email notifications');
};
