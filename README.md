# Bakery POS

Offline-first point of sale for a small bakery kiosk. Runs as a PWA on a phone. Cash and
PromptPay QR. Built with React + TypeScript + Vite + Dexie, developed with Claude Code agents.

## Get started

```bash
npm install
npm run dev          # open on your phone via the LAN URL Vite prints (use --host)
npm test
```

## Develop with agents

Everything the agents need is in the repo:

| File                    | Purpose                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`             | Rules every agent session loads (money, offline, schema, done-criteria)                                                |
| `docs/SPEC.md`          | What we are building and why                                                                                           |
| `docs/PLAN.md`          | Ordered tasks with acceptance criteria — the implementer works from this                                               |
| `.claude/agents/`       | planner · implementer · reviewer · tester · docs-ops                                                                   |
| `.claude/settings.json` | Pre-approved commands, denied commands, hooks                                                                          |
| `.claude/hooks/`        | protect-files (blocks .env, lockfile, dist), format-file (prettier), test-gate (tests must pass before an agent stops) |

Typical loop, from the repo root:

```
claude
> use the planner agent to refine task 1 in docs/PLAN.md
   (read the plan, edit it, paste it back)
> use the implementer agent to do task 1
> use the reviewer agent on the diff
> use the tester agent on the diff
> fix anything they found, then merge the branch
```

When the repo is on GitHub, run `/install-github-app` inside `claude` and enable
`.github/workflows/claude-review.yml` so every PR is reviewed automatically.

## Layout

```
src/domain/   pure business rules (money, cart, reports) — no React, no Dexie
src/db/       Dexie schema, seed data, order operations
src/components/  reusable UI
src/screens/  one file per screen
src/test/     vitest setup (fake-indexeddb, jest-dom)
```
