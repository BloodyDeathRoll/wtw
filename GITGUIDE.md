# WTW — Git Guide
## Simple instructions for all three collaborators

---

## First time only — Clone the repo

Do this once on your machine. Never again.

```bash
git clone https://github.com/BloodyDeathRoll/wtw.git
cd wtw
npm install
```

Then create your branch (pick the one that matches your assignment):

```bash
# Assignment 1
git checkout -b feature/session-brain

# Assignment 2
git checkout -b feature/rec-engine

# Assignment 3
git checkout -b feature/dna-writer
```

Push your branch to GitHub so it exists remotely:

```bash
git push -u origin feature/your-branch-name
```

---

## Starting a session

Run these three commands every time you open the project. Takes 30 seconds.

```bash
git checkout feature/your-branch-name   # make sure you're on your branch
git fetch origin                        # check what teammates have merged
git merge origin/main                   # pull in anything new from main
```

If the last command shows conflicts (rare), come to the group chat before touching anything.

Then open Claude Code and start with:
> "Read CLAUDE.md and then let's continue where we left off."

---

## During a session

Save your work regularly. Every time you finish something that works, commit it:

```bash
git add -p                              # review what you're saving (use 'y' to include, 'n' to skip)
git commit -m "short description of what you did"
git push origin feature/your-branch-name
```

**Good commit message examples:**
- `feat: add ConversationInterface streaming`
- `feat: build scoring pipeline step 1-3`
- `fix: confidence weighting off by one`
- `chore: add Supabase client util`

**Bad commit message examples:**
- `update`
- `stuff`
- `wip`

Commit little and often. If Claude Code goes sideways, small commits mean you can roll back to the last working state without losing everything.

---

## Ending a session

**Step 1 — Commit everything you did today:**
```bash
git add -p
git commit -m "end of session: describe where you got to"
git push origin feature/your-branch-name
```

**Step 2 — Update CLAUDE.md before you close:**

Open `CLAUDE.md` and update the **Current Status** section for your assignment:
- Tick off what you completed
- Note what's in progress
- Write "Next session starts at: [the next task]"

Commit that update:
```bash
git add CLAUDE.md
git commit -m "chore: update session status"
git push origin feature/your-branch-name
```

This takes 2 minutes and means the next Claude Code session starts productively instead of spending an hour figuring out where things are.

---

## Opening a Pull Request (at milestone only)

You only open a PR when you've hit a full handoff milestone from the assignments doc — not after every session.

1. Go to https://github.com/BloodyDeathRoll/wtw
2. Click **"Compare & pull request"** next to your branch
3. Title: `Assignment 1: Session Brain — onboarding + conversation UI` (or equivalent)
4. Description: paste your completed checklist from the assignments doc
5. Request review from the other two collaborators
6. Wait for at least one approval before merging

**Important:** If your PR touches `src/types/dna.ts`, all three collaborators must approve before it merges. No exceptions.

---

## After someone else's PR merges to main

You'll see a notification on GitHub. Run this before your next session:

```bash
git fetch origin
git merge origin/main
```

If there are conflicts, message the group before trying to resolve them.

---

## Emergency: I broke something

**If you haven't committed yet:**
```bash
git checkout .          # throws away all unsaved changes, goes back to last commit
```

**If you already committed the broken thing:**
```bash
git log --oneline -10   # see your last 10 commits, find the good one
git revert HEAD         # undo the last commit safely (doesn't delete history)
```

Never use `git reset --hard` on a branch that's been pushed. Message the group if you're unsure.

---

## Quick reference card

| Situation | Command |
|---|---|
| Start of session | `git checkout feature/your-branch` then `git merge origin/main` |
| Save progress | `git add -p` → `git commit -m "..."` → `git push` |
| End of session | commit + push + update CLAUDE.md + commit CLAUDE.md + push |
| Someone merged to main | `git fetch origin` → `git merge origin/main` |
| Throw away unsaved changes | `git checkout .` |
| See what branch you're on | `git branch` |
| See recent commits | `git log --oneline -10` |

---

## Rules everyone must follow

1. **Never commit directly to `main`** — always work on your feature branch
2. **Never modify `src/types/dna.ts` alone** — any change needs all three to review
3. **Never commit `.env.local`** — it's in `.gitignore` for a reason, it contains secret keys
4. **Update CLAUDE.md at the end of every session** — it's how the team stays in sync
5. **Small commits beat big ones** — commit every time something works, not just at the end

---

*If something feels wrong or you're unsure — message the group before pushing. It's always easier to fix before it's in the repo.*
