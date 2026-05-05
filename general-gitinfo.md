# Git & Pull Requests — A Plain English Guide

---

## The mental model

Think of `main` as the **official version of the project** — the one everyone agrees is good. Your feature branch is your **personal workspace** where you build things without affecting anyone else.

A **pull request (PR)** is simply you saying: *"I finished something on my branch — can someone check it before we add it to the official version?"*

**Merging** is the moment it actually gets added.

That's it. Everything else is just the mechanics of how you do that on GitHub.

---

## Why bother? Why not just all work on main?

Because if three people push broken code directly to main at the same time, nobody can work. The branch + PR system means your half-finished work never touches the official version until it's ready and someone has looked at it.

---

## The full lifecycle, step by step

**1. You work on your branch**
You build, commit, push. None of this affects anyone else. They can't even see your changes in the code unless they go looking.

**2. You decide you're ready to merge**
This happens at a milestone — not after every session. For WTW, the milestones are the handoff criteria at the bottom of each assignment.

**3. You open a Pull Request on GitHub**
- Go to https://github.com/BloodyDeathRoll/wtw
- GitHub will usually show a yellow banner saying *"feature/your-branch had recent pushes — Compare & pull request"* — click that
- Or go to the **Pull requests** tab → **New pull request**
- Set it to merge **your branch → main**
- Write a title and a short description of what you built
- Click **Create pull request**

**4. Your teammates review it**
They can see every line you changed, leave comments, ask questions, or approve it. For WTW the rule is: at least one approval before merging. If anyone touches `src/types/dna.ts`, all three must approve.

**5. Someone clicks Merge**
Once approved, whoever opened the PR clicks **Merge pull request** on GitHub. Your changes are now in `main`.

**6. Everyone else pulls main**
The other two run `git merge origin/main` at the start of their next session and get your changes automatically.

---

## What a conflict is and when it happens

A conflict happens when two people changed the **same line of the same file** on different branches, and Git can't figure out which version to keep. It asks you to decide.

This should be rare if everyone sticks to their own folders. The most likely place it happens is `CLAUDE.md` since everyone updates it. If you get a conflict:

```bash
git merge origin/main
# Git will say "CONFLICT in CLAUDE.md"
```

Open the file. Git marks the conflict like this:

```
<<<<<<< your branch
your version of the line
=======
their version of the line
>>>>>>> main
```

Delete the markers, keep whichever version is correct (or combine both), save, then:

```bash
git add CLAUDE.md
git commit -m "fix: resolve merge conflict in CLAUDE.md"
```

Message the group when this happens — don't guess.

---

## Rules for this project

- **Never merge your own PR without at least one teammate approval** — the point is a second pair of eyes
- **Any change to `src/types/dna.ts` needs all three to approve** before merging — it's the shared contract
- **The first PR goes to main before anyone else branches** — that's the scaffold commit with CLAUDE.md, dna.ts, and the folder structure. Everyone branches from that.
- **Small PRs are easier to review than big ones** — if you've built three features, three small PRs are better than one giant one

---

## The short version you'll actually remember

| Step | What you do |
|---|---|
| Start work | `git checkout -b feature/your-branch` |
| Save progress | `git add -p` → `git commit -m "..."` → `git push` |
| Ready to share | Open PR on GitHub, ask for review |
| Got approved | Click **Merge** on GitHub |
| Teammate merged something | `git merge origin/main` at start of next session |
| Threw away unsaved changes | `git checkout .` |
| See recent commits | `git log --oneline -10` |

---

## Good commit messages vs bad ones

**Good:**
- `feat: add ConversationInterface streaming`
- `feat: build scoring pipeline steps 1–3`
- `fix: confidence weighting off by one`
- `chore: update CLAUDE.md session status`

**Bad:**
- `update`
- `stuff`
- `wip`
- `asdfgh`

Good messages make it easy to find the last working state if something breaks. Bad messages make the history useless.

---

## Emergency: I broke something

**If you haven't committed yet — throw away all unsaved changes:**
```bash
git checkout .
```

**If you already committed the broken thing — undo the last commit safely:**
```bash
git log --oneline -10    # find the last good commit
git revert HEAD          # creates a new commit that undoes the last one
```

Never use `git reset --hard` on a branch that's been pushed. Message the group if you're unsure.

---

## The one rule that covers everything

**Your branch is your sandbox. Main is sacred. Nothing goes into main without a PR and at least one approval.**
