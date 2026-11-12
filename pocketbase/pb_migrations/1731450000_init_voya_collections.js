/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    try {
      app.findCollectionByNameOrId('user_trips')
    } catch {
      const userTrips = new Collection({
        type: 'base',
        name: 'user_trips',
        listRule: 'user = @request.auth.id',
        viewRule: 'user = @request.auth.id',
        createRule: 'user = @request.auth.id',
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
            type: 'json',
            name: 'payload',
            required: true,
          },
        ],
        indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS idx_user_trips_user ON user_trips (user)'],
      })
      app.save(userTrips)
    }

    try {
      app.findCollectionByNameOrId('shared_itineraries')
    } catch {
      const shared = new Collection({
        type: 'base',
        name: 'shared_itineraries',
        // Authenticated users can read active shares (token accept + owner/member flows).
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: 'owner = @request.auth.id',
        updateRule: 'owner = @request.auth.id',
        deleteRule: 'owner = @request.auth.id',
        fields: [
          {
            type: 'relation',
            name: 'owner',
            required: true,
            maxSelect: 1,
            collectionId: users.id,
            cascadeDelete: true,
          },
          { type: 'text', name: 'share_token', required: true },
          { type: 'text', name: 'source_trip_id', required: true },
          { type: 'json', name: 'trip_json', required: true },
          {
            type: 'select',
            name: 'default_permission',
            required: true,
            maxSelect: 1,
            values: ['viewer', 'editor'],
          },
          { type: 'date', name: 'revoked_at', required: false },
        ],
        indexes: ['CREATE INDEX IF NOT EXISTS idx_shared_token ON shared_itineraries (share_token)'],
      })
      app.save(shared)
    }

    const sharedCol = app.findCollectionByNameOrId('shared_itineraries')

    try {
      app.findCollectionByNameOrId('shared_itinerary_members')
    } catch {
      const members = new Collection({
        type: 'base',
        name: 'shared_itinerary_members',
        listRule: 'user = @request.auth.id || shared_itinerary.owner = @request.auth.id',
        viewRule: 'user = @request.auth.id || shared_itinerary.owner = @request.auth.id',
        createRule: '@request.auth.id != ""',
        updateRule: 'shared_itinerary.owner = @request.auth.id || user = @request.auth.id',
        deleteRule: 'shared_itinerary.owner = @request.auth.id',
        fields: [
          {
            type: 'relation',
            name: 'shared_itinerary',
            required: true,
            maxSelect: 1,
            collectionId: sharedCol.id,
            cascadeDelete: true,
          },
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
            name: 'role',
            required: true,
            maxSelect: 1,
            values: ['viewer', 'editor'],
          },
          { type: 'date', name: 'joined_at', required: false },
          { type: 'date', name: 'revoked_at', required: false },
        ],
      })
      app.save(members)
    }

    try {
      app.findCollectionByNameOrId('place_cache')
    } catch {
      const cache = new Collection({
        type: 'base',
        name: 'place_cache',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { type: 'text', name: 'cache_key', required: true },
          { type: 'text', name: 'kind', required: true },
          { type: 'json', name: 'payload', required: true },
          { type: 'text', name: 'source', required: false },
          { type: 'text', name: 'fetched_at', required: false },
          { type: 'number', name: 'ttl_days', required: false },
        ],
        indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS idx_place_cache_key ON place_cache (cache_key)'],
      })
      app.save(cache)
    }

    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.updateRule = 'id = @request.auth.id'
    app.save(users)
  },
  (app) => {
    for (const name of ['place_cache', 'shared_itinerary_members', 'shared_itineraries', 'user_trips']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch {
        // ignore
      }
    }
  },
)
