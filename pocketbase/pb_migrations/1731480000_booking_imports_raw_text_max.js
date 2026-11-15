/// <reference path="../pb_data/types.d.ts" />

// Forwarded airline/Airbnb emails often exceed PB's default text max (5000).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('booking_imports')
    const field = col.fields.getByName('raw_text')
    if (field) {
      field.max = 100000
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('booking_imports')
    const field = col.fields.getByName('raw_text')
    if (field) {
      field.max = 0
      app.save(col)
    }
  },
)
