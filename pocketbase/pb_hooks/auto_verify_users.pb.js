// Household deploy has no SMTP - mark new users verified on create.
onRecordCreate(function (e) {
  try {
    e.record.set('verified', true)
  } catch (err) {}
  e.next()
}, 'users')
