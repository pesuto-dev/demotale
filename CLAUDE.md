# demotale

Records a narrated demo video of a running web app. Playwright plays a scripted click path, an
overlay injected into the page explains each step, ffmpeg produces an mp4, a gif and a subtitle
track. The point is that the recording lives in git and can be made again by CI, so it never goes
stale.

## Where the plan lives

The working documents are in `.plan/`, which is **gitignored on purpose**: they are Dutch and this
repo is meant to be public.

| File | What it holds |
| --- | --- |
| `.plan/KOERS.md` | **Read this first.** The direction after the pivot: an agent writes the scenario, a person types one sentence. It replaces the front door `achtergrond/PLAN.md` describes, and lists what freezes. |
| `.plan/OVERDRACHT.md` | Where the work stands, which branch it is on, what is still open, and how to rebuild the trial setup. Read straight after KOERS. |
| `.plan/stappen/STAP-A.md` … `STAP-G.md` | One per step of KOERS. A–F: written when the acceptance criterion passed. G: the publish plan (not done yet). |
| `.plan/proeven/bouw-sandbox.py` | Builds the sandbox those trials ran in, in one command. Takes `--raamwerk` for the Angular version of the same application. |
| `.plan/achtergrond/PLAN.md` | The build plan that produced what is here now, phase by phase, each with an acceptance criterion. |
| `.plan/achtergrond/DESIGN.md` | The v1 package surface: config, scenario API, CLI, output layout. |
| `.plan/achtergrond/LESSONS.md` | Measured findings from the tool this grew out of. Read before touching the overlay, the spotlight, rendering or login. |
| `.plan/achtergrond/POSITIONING.md` | Audience, positioning, pitch copy. |
| `.plan/achtergrond/README.draft.md` | English draft of the public README (superseded by root `README.md`; kept for history). |

To pick up work: read `.plan/KOERS.md` and do the first step that is not finished. A step is finished
when its acceptance criterion passes, not when the files exist.

## Rules for this repo

- Code, comments, docs, commit messages and issues are **English**. Only the documents in `.plan/`
  are Dutch.
- Nothing customer-specific ever lands here. No client names, no internal hostnames, no tenant data,
  no screenshots of a real environment. Examples use `localhost` and `example.com`.
- The private tool this code grew out of is **read-only** reference material.
  Never change anything in that repo. When lifting code from it, strip its project-specific names.
- Commit each finished piece. **Never push without being asked.**
- Measure before changing. An assumption written down as fact costs an evening later;
  `.plan/achtergrond/LESSONS.md` is the list of times that already happened.

## Layout

```
src/              the package: demo, overlay, theme, config, playwright, render, join, captions, cli/
templates/        what `demotale init` writes into a user's project
test/             vitest, unit only
docs/             English user docs + media/example.gif
examples/basic/   tiny static app plus a scenario, recorded by CI
.plan/            Dutch working docs (gitignored): KOERS, OVERDRACHT, stappen/, achtergrond/, proeven/
```

## Commands

```
npm run build      tsc to dist/, types included
npm test           vitest
npm run typecheck  tsc --noEmit over src and test
```
