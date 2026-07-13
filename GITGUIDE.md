# WTW — Git Guide
## Simple instructions for all three collaborators

> **We are now in the integration phase.** All three assignments are merged into `main`.
> The workflow below replaces the old "one long-lived branch per person" model — that was
> right while each of us lived inside our own `src/modules/<x>/` folder. The work now is
> wiring the modules together, which happens in shared files, so we switch to
> **short-lived task branches cut fresh off `main` and merged back fast.**

---

## Getting the latest code

**You already have the repo cloned — do NOT delete your folder or re-clone.** Everything is now merged into `main`; just update your existing checkout in place:

```bash
cd wtw                     # your existing project folder
git checkout main          # leave whatever old branch you were on
git fetch --prune origin   # get the latest refs, drop branches deleted on GitHub
git pull origin main       # fast-forward main to the fully merged state
npm install                # dependencies changed (test harness was added) — resync
```

That's it — your folder now matches everyone's merged work.

> If `git checkout main` complains about local changes, you have uncommitted edits on your old branch. Your assignment work is already merged into `main`, so unless there's something you still need, discard them with `git checkout .` (or `git stash` to set them aside), then retry.

**Tidy up your old branch (optional).** The old per-person branches are gone from GitHub; drop your stale local copies:

```bash
git branch -d feature/session-brain    # or feature/rec-engine / feature/dna-writer
```

`-d` refuses to delete a branch with unmerged work — that's the safety net. If you're certain it's all merged, use `-D`.

### Your environment file

You already have `.env.local`, and pulling never touches it (it's gitignored). If Shahar sends an updated one — because a key changed — just replace the file. **Never commit `.env.local`.**

> Why a file and not `vercel env pull`? Vercel removed the free Hobby team tier, so the project lives under a personal account and teammates can't pull env vars from the dashboard.

### Brand-new machine only (rare)

Only if you've *never* set the project up anywhere:

```bash
git clone https://github.com/BloodyDeathRoll/wtw.git
cd wtw
npm install
```

Then get `.env.local` from Shahar and drop it next to `package.json`.

---

That's the whole setup — you do **not** create a permanent personal branch anymore. Branches are created per task, see below.

---

## The mental model (read this once)

- **`main` is the shared trunk.** It always builds and runs. Nobody commits to it directly — everything lands via a reviewed PR.
- **One task = one short-lived branch = one small PR.** A branch is born off the latest `main`, does one thing, gets reviewed, merges, and is deleted. You'll often have two or three in a week.
- **Branches are named by the work, not by the person.** `feat/wire-dna-on-session-end`, not `feature/eran`.
- **Module ownership still holds.** Only the owner edits their `src/modules/` folder:
  - `src/modules/session/` → Assignment 1 - Shahar
  - `src/modules/engine/` → Assignment 2 - Alon
  - `src/modules/dna/` → Assignment 3 - Eran
- **Shared areas need a heads-up.** `src/app/`, `src/lib/` — one person at a time; say so in the group chat before you start. `src/types/dna.ts` needs **all three** to approve any change.
- **Foundation changes land on main first.** Anything everyone builds on — root config (`package.json`, `vitest.config.ts`, `tsconfig`, eslint), the test harness under `tests/`, shared mocks — is owned by one person, goes in as a small **priority PR**, and merges before the work that depends on it. Don't scaffold shared tooling inside a feature branch; three people doing that in parallel is a guaranteed conflict.

## Tests

The harness is Vitest + React Testing Library. Run `npm test` (once) or `npm run test:watch` (while developing). Tests live under `tests/` — see `tests/README.md` for layout, conventions, and how to wire the shared Supabase/Redis/Groq mocks into a test. A test for `src/modules/<x>/` is written by that module's owner, same as the code.

## Deployments (Vercel)

One Vercel account (Shahar's) is connected to the repo — **you never connect your own.** Git-triggered deployments are turned off entirely (`vercel.json` → `git.deploymentEnabled: false`), so **no push, on any branch, spawns a Vercel build** — no preview noise, and none of the "git author must have access" failures the free plan throws for teammate-authored commits.

Production deploys instead run through a GitHub Action (`.github/workflows/deploy-production.yml`): on every merge to `main` it calls a Vercel **Deploy Hook**, which deploys the latest `main` as the project owner regardless of who authored the commit. So merges auto-deploy for everyone, and there's still only one Vercel account. If a production deploy fails, that's Shahar's to sort out. (One-time admin setup — the Deploy Hook URL — is documented in the workflow file.)

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
