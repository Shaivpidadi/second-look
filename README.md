# Second Look

Glasses watch the paper, the screen reader watches typed values, the system
acts: catches mismatches live, blocks submit, proposes fixes, logs an audit
trail, drafts damage claims.

## Layout

- `apps/web` — Next.js: mock warehouse form (`/form`) and API routes
- `packages/validators` — check-digit validators (AWB, ISO 6346, GS1/SSCC)
- `packages/pipeline` — SAM crop, Glimmer, Spark, verdict, audit, claim
- `eval/generator` — synthetic BOL/AWB/POD documents plus error injector
- `clips/` — POV fallback clips (not committed)

## Run

Copy `.env.example` to `.env` and add keys. Then:

```sh
pnpm install
pnpm test
```

See `BRIEF.md` and `PLAN.md` for the full plan.
