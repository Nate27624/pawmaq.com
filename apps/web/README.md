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
- upload budget: `50MB` daily (`text + media`)
- anonymous passkey sign-in for posting, commenting, voting, and media upload
- cross-device QR sign-in and signed-in account linking
- hidden `/ledger` route for searchable full ledger export (not linked from main feed UI)
- hidden `/test-lab` route for interactive test-case generation (custom users/posts/comments/replies + scenario runs)

## Run

From repo root:

```bash
corepack pnpm install
corepack pnpm dev:web
```

Open `http://localhost:5173`.

## Anonymous Passkey Sign-In

The web app requests a human-verification challenge from the API and solves a local proof-of-work before passkey
register/auth options are requested.

Set the API base URL for server-persisted profiles (optional in local dev when Vite proxy is enabled):

```bash
VITE_API_BASE_URL=http://localhost:3000
```
