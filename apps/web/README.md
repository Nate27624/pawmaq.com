# @pawmaq/web

Frontend UI prototype for pawmaq:

- dark/light mode toggle
- X + YouTube-inspired layout
- feed tabs: `Following`, `World`
- time windows: `10 min`, `1 hr`, `12 hrs`, `24 hrs`, `1 week`, `1 month`, `3 months`, `1 year`
- world map-based country filter in `World`
- sort mode in account settings: `Most likes` or `Highest approval`
- text-only posts or optional media uploads (`video`, `gif`, `png`)
- `.jpg` and `.jpeg` uploads auto-convert to `.png` in-browser
- upload budget: `200MB` total per post (`text + media`)
- optional Google sign-in for posting, commenting, voting, and media upload
- hidden `/ledger` route for searchable full ledger export (not linked from main feed UI)
- hidden `/test-lab` route for interactive test-case generation (custom users/posts/comments/replies + scenario runs)

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

Set the API base URL for server-persisted profiles:

```bash
VITE_API_BASE_URL=http://localhost:3000
```
