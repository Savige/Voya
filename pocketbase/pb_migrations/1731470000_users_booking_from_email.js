/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    let has = false
    const fields = users.fields
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].name === 'booking_from_email') {
        has = true
        break
      }
    }
    if (!has) {
      // Text field keeps matching flexible; uniqueness enforced when non-empty.
      users.fields.add(
        new TextField({
          name: 'booking_from_email',
          required: false,
          presentable: true,
        }),
      )
      users.indexes.push(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_booking_from_email ON users (booking_from_email) WHERE booking_from_email != ""',
      )
      app.save(users)
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    try {
      users.fields.removeByName('booking_from_email')
      users.indexes = (users.indexes || []).filter(
        (idx) => !String(idx).includes('idx_users_booking_from_email'),
      )
      app.save(users)
    } catch (_) {}
  },
)
