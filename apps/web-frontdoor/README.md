# Nelyon web front door

This Cloudflare Worker deploys one same-origin artifact for `nelyon.app`:

- Astro Public Web at the root, including the exact public `/business` page.
- Business Vite SPA files under `/business/`, with document-navigation fallback handled by the Worker.

`npm run build` requires the Business Web public build variables (`VITE_SUPABASE_URL` and either `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`). Private server credentials must never be supplied to this build.

The generated `dist/` directory and Wrangler local state are intentionally untracked.
