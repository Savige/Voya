# Local frontend → remote PocketBase

Use when the SPA runs on your Mac (`npm run dev`) but PocketBase runs on the NAS.

```env
VITE_POCKETBASE_URL=https://pocketbase.savige.me
VITE_DEV_AUTH_BYPASS=0
```

Restart Vite after changing env. No Google API keys are required.
