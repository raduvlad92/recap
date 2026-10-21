# recap/

A working v0 of a reader-controlled creator workspace. Follow studios, presenters and channels; explore dated updates and topic views; save a personal reading library.

- Review URL: https://recap-v0-radu.netlify.app
- Owner checklist: [docs/v0/MORNING.md](docs/v0/MORNING.md)
- Active v0 plan: [docs/v0/PLAN.md](docs/v0/PLAN.md)
- Progress and verification: [STATUS.md](STATUS.md), [docs/DEMO-LOG.md](docs/DEMO-LOG.md)
- Modular creator model: [docs/CREATOR-MODEL.md](docs/CREATOR-MODEL.md)

The fictional starter collection is explicitly labeled. Actual feed collection requires sign-in and displays source extracts, not generated AI analysis. Apify's YouTube adapter is implemented but paid execution stays disabled until its activation and aggregate-budget checks are satisfied. Seven-platform access, automatic daily AI recaps, translation, transcription and email delivery are not claimed as working v0 behavior.

## Run locally

Node 22.12 or later and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Fill only this app's public configuration in `.env.local`; use the selected Clerk application and Supabase project. Never put an Apify token or any service/secret key in a `VITE_` variable. Account state is protected by native Clerk JWTs and Supabase row-level policies. Guest changes stay on the device; account changes have a visible save state.

```sh
npm run check
```

This runs the meaningful domain/collection tests, TypeScript and production build. Netlify functions are emulated by the Vite plugin. No Edge Functions, Netlify Database/Blobs or Cloudflare resources are required.

## Deploy and maintain

A passing GitHub main-branch check triggers a Netlify build through a project-scoped GitHub Actions secret. Netlify clones the private repository with a read-only deploy key; no account-wide Netlify token is shared.

Netlify settings and functions are in `netlify.toml` and `netlify/functions/`; publish only `dist`, not the repository root. `.local/`, `.env*`, `.netlify/`, `supabase/.temp/`, build outputs and test credentials are ignored. Database files are in `supabase/migrations/`; the v0 schema was applied only after an empty-schema preflight on the founder's recap project, with recorded live authorization checks.

Read [AGENTS.md](AGENTS.md), STATUS, SPEC, PLAN and decisions before resuming. Full SPEC/PLAN v1.1 is a broader candidate; founder D20 separately authorizes this v0. Preserve the reference design and scope boundaries, save evidence and update the morning checklist. Font license is served at `/licenses/onest.txt`.
