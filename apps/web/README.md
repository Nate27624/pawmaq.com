# @pawmaq/web

Frontend UI prototype for pawmaq:

- dark/light mode toggle
- X + YouTube-inspired layout
- local video upload composer
- World tab with popularity-ranked feed and proportional country support map
- Controversial tab with conflicting-report ranking and worst-vote ranking
- Current frontend upload limit: `200MB` total per post (`text + media`)
- Optional Google sign-in for posting, commenting, and media upload

## Run

From repo root:

```bash
corepack pnpm install
corepack pnpm dev:web
```

Open `http://localhost:5173`.

## Google Sign-In

Set a Google OAuth client id for browser auth:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```
