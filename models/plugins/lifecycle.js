/**
 * Mongoose plugin emitting lifecycle events on the model class.
 *
 * Drop-in replacement for the unmaintained mongoose-lifecycle package
 * (which relies on the `remove` hook removed from Mongoose).
 *
 *     Check.on('afterInsert', function(check) { ... });
 *
 * Events: beforeInsert, afterInsert, beforeUpdate, afterUpdate,
 * beforeSave and afterSave (for both inserts and updates),
 * beforeRemove and afterRemove (on document.deleteOne()).
 */
module.exports = function lifecycleEventsPlugin(schema) {
  schema.pre('save', function() {
    this.$locals.lifecycleWasNew = this.isNew;
    this.constructor.emit('beforeSave', this);
    this.constructor.emit(this.isNew ? 'beforeInsert' : 'beforeUpdate', this);
  });
  schema.post('save', function(doc) {
    doc.constructor.emit('afterSave', doc);
    doc.constructor.emit(doc.$locals.lifecycleWasNew ? 'afterInsert' : 'afterUpdate', doc);
    delete doc.$locals.lifecycleWasNew;
  });
  schema.pre('deleteOne', { document: true, query: false }, function() {
    this.constructor.emit('beforeRemove', this);
  });
  schema.post('deleteOne', { document: true, query: false }, function(doc) {
    doc.constructor.emit('afterRemove', doc);
  });
};
