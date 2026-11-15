/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    try {
      app.findCollectionByNameOrId('booking_imports')
    } catch {
      const imports = new Collection({
        type: 'base',
        name: 'booking_imports',
        listRule: 'user = @request.auth.id',
        viewRule: 'user = @request.auth.id',
        createRule: null,
        updateRule: 'user = @request.auth.id',
        deleteRule: 'user = @request.auth.id',
        fields: [
          {
            type: 'relation',
            name: 'user',
            required: true,
            maxSelect: 1,
            collectionId: users.id,
            cascadeDelete: true,
          },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['pending', 'applied', 'dismissed', 'failed'],
          },
          {
            type: 'select',
            name: 'kind',
            required: true,
            maxSelect: 1,
            values: ['flight', 'rentalCar', 'accommodation', 'restaurant', 'unknown'],
          },
          { type: 'text', name: 'from_email', required: false },
          { type: 'text', name: 'subject', required: false },
          { type: 'text', name: 'trip_id', required: false },
          { type: 'json', name: 'parsed', required: true },
          { type: 'text', name: 'raw_text', required: false },
          { type: 'text', name: 'error', required: false },
          { type: 'text', name: 'message_id', required: false },
        ],
        indexes: [
          'CREATE INDEX IF NOT EXISTS idx_booking_imports_user_status ON booking_imports (user, status)',
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_imports_message ON booking_imports (message_id) WHERE message_id != ""',
        ],
      })
      app.save(imports)
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('booking_imports'))
    } catch (_) {}
  },
)
