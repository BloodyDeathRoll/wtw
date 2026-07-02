# WTW — Git Guide
## Simple instructions for all three collaborators

> **We are now in the integration phase.** All three assignments are merged into `main`.
> The workflow below replaces the old "one long-lived branch per person" model — that was
> right while each of us lived inside our own `src/modules/<x>/` folder. The work now is
> wiring the modules together, which happens in shared files, so we switch to
> **short-lived task branches cut fresh off `main` and merged back fast.**

---

## First time only — Clone the repo

Do this once on your machine. Never again.

```bash
git clone https://github.com/BloodyDeathRoll/wtw.git
cd wtw
npm install
```

**Get your environment variables** — without these the app won't run.

Ask Shahar for the latest `.env.local` (shared over chat — never in the repo). Drop it in the project root so it sits next to `package.json`:

```
wtw/
├── .env.local       ← here
├── package.json
└── ...
```

**Never commit `.env.local`** — it's gitignored, and it holds every API key the app uses. If a key changes, Shahar will share an updated file.

> Why a file and not `vercel env pull`? Vercel removed the free Hobby team tier, so the project lives under a personal account and teammates can't pull env vars from the dashboard.

That's the whole setup — you do **not** create a permanent personal branch anymore. Branches are created per task, see below.

---

## The mental model (read this once)

- **`main` is the shared trunk.** It always builds and runs. Nobody commits to it directly — everything lands via a reviewed PR.
- **One task = one short-lived branch = one small PR.** A branch is born off the latest `main`, does one thing, gets reviewed, merges, and is deleted. You'll often have two or three in a week.
- **Branches are named by the work, not by the person.** `feat/wire-dna-on-session-end`, not `feature/eran`.
- **Module ownership still holds.** Only the owner edits their `src/modules/` folder:
  - `src/modules/session/` → Assignment 1
  - `src/modules/engine/` → Assignment 2
  - `src/modules/dna/` → Assignment 3
- **Shared areas need a heads-up.** `src/app/`, `src/lib/` — one person at a time; say so in the group chat before you start. `src/types/dna.ts` needs **all three** to approve any change.
- **Foundation changes land on main first.** Anything everyone builds on — root config (`package.json`, `vitest.config.ts`, `tsconfig`, eslint), the test harness under `tests/`, shared mocks — is owned by one person, goes in as a small **priority PR**, and merges before the work that depends on it. Don't scaffold shared tooling inside a feature branch; three people doing that in parallel is a guaranteed conflict.

## Tests

The harness is Vitest + React Testing Library. Run `npm test` (once) or `npm run test:watch` (while developing). Tests live under `tests/` — see `tests/README.md` for layout, conventions, and how to wire the shared Supabase/Redis/Groq mocks into a test. A test for `src/modules/<x>/` is written by that module's owner, same as the code.

## Deployments (Vercel)

One Vercel account (Shahar's) is connected to the repo — **you never connect your own.** No branch except `main` gets preview deployments (`vercel.json` disables all branches via `"**": false`), so your pushes won't spawn Vercel build noise regardless of what you name your branch. Only `main` auto-deploys to production, which happens automatically when a PR merges. If a production deploy fails, that's Shahar's to sort out.

---

# Your day-to-day session loop

> Every working session has the same three beats: **open**, **work**, **close**.

### 1. Starting a task

Always branch from the freshest `main`.

```bash
git checkout main
git pull origin main                       # get everything teammates merged
git checkout -b feat/short-task-name       # your new task branch
```

Branch-name prefixes we use:
- `feat/…` — new functionality (`feat/wire-real-rec-pipeline`)
- `fix/…` — bug fix (`fix/external-rating-halving`)
- `test/…` — tests / harness (`test/vitest-setup`)
- `chore/…` — tooling, docs, config (`chore/update-gitguide`)

Then open Claude Code and start with:
> "Read CLAUDE.md and then let's continue where we left off."

### 2. During a task

Save your work regularly. Every time something works, commit it:

```bash
git add -p                              # review what you're saving ('y' include, 'n' skip)
git commit -m "short description of what you did"
git push -u origin feat/short-task-name   # -u the first push; plain `git push` after
```

**Good commit messages:** `feat: call updateSchemaFromSession on chat end` · `fix: confidence weighting off by one` · `chore: add Supabase client util`
**Bad:** `update` · `stuff` · `wip`

Commit little and often. Small commits mean you can roll back to the last working state without losing everything.

**If `main` moves while you're working** (someone else merged), pull it into your branch so you don't drift:

```bash
git fetch origin
git merge origin/main                   # resolve any conflicts locally
```

Because branches are short-lived, this is usually a clean fast-forward.

### 3. Ending a task — open the PR

Open a PR **per task, while it's still small** (aim for under ~300 changed lines). Do not sit on a branch for days.

```bash
git add -p
git commit -m "describe where you got to"
git push origin feat/short-task-name
```

Then on GitHub:
1. Go to https://github.com/BloodyDeathRoll/wtw → **"Compare & pull request"**.
2. Title = what the branch does. Description = what changed + how you tested it.
3. Request review from **one** teammate (the owner of any shared file you touched).
4. **If your PR touches `src/types/dna.ts`, request all three — no merge without all three approvals.**
5. One approval → **Squash and merge** → **delete the branch** (GitHub offers a button; do it).

### 4. Update CLAUDE.md at a milestone

When you finish a meaningful chunk, update the **Current Status** section for your assignment in `CLAUDE.md` (tick off what's done, note what's next). Fold it into your task PR or a small `chore/` PR. This is how the next Claude Code session starts productively instead of re-discovering state.

---

## After someone else's PR merges to main

You don't need to do anything mid-task except the optional `merge origin/main` above. Before your **next** task you always start from fresh main anyway:

```bash
git checkout main
git pull origin main
```

If a merge produces conflicts you don't understand, message the group before resolving.

---

## Cleaning up merged branches

After your PR merges, the branch is dead. Tidy up so stale branches don't pile up:

```bash
git checkout main
git pull origin main
git branch -d feat/short-task-name          # delete your local copy (safe: only if merged)
git fetch --prune origin                    # drop remote-tracking refs GitHub already deleted
```

`-d` refuses to delete an unmerged branch — that's a feature. If you're **sure** an old branch's work is already in main under a different squash-commit and you still can't `-d` it, verify with `git log --oneline main | grep <keywords>` first, then `git branch -D`.

---

## Emergency: I broke something

**Haven't committed yet:**
```bash
git checkout .          # throw away unsaved changes, back to last commit
```

**Already committed the broken thing (and pushed):**
```bash
git log --oneline -10   # find the last good commit
git revert HEAD         # undo the last commit safely (keeps history)
git push
```

Never use `git reset --hard` on a branch that's been pushed. Message the group if unsure.

---

## Quick reference card

| Situation | Command |
|---|---|
| Start a task | `git checkout main` → `git pull` → `git checkout -b feat/name` |
| Save progress | `git add -p` → `git commit -m "..."` → `git push` |
| Pull in main mid-task | `git fetch origin` → `git merge origin/main` |
| Finish a task | commit + push → open small PR → 1 approval → squash-merge → delete branch |
| After a merge, next task | `git checkout main` → `git pull` |
| Delete a merged branch | `git branch -d feat/name` → `git fetch --prune origin` |
| Throw away unsaved changes | `git checkout .` |
| See what branch you're on | `git branch` |

---

## Rules everyone must follow

1. **Never commit directly to `main`** — always a short-lived task branch + PR.
2. **One task, one small branch, one PR** — don't let a branch live for days or grow past a few hundred lines.
3. **Only edit your own `src/modules/` folder.** Touching `src/app/` or `src/lib/`? Call it in the group chat first (one person at a time).
4. **Never modify `src/types/dna.ts` alone** — any change needs all three to review.
5. **Never commit `.env.local`** — it's gitignored and holds secret keys.
6. **Delete branches after they merge** and keep `main` green (it must always build and run).

---

*If something feels wrong or you're unsure — message the group before pushing. It's always easier to fix before it's in the repo.*
