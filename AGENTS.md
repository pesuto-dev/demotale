# Agents: demotale

demotale records a **narrated demo video** of a **locally running web app**: Playwright plays a
scripted click path, on-page text overlays explain each step, and ffmpeg produces mp4/gif plus
subtitles and a transcript. No microphone, no SaaS upload.

## When to reach for it

Use demotale when someone asks for a demo, screencast, product walkthrough, or README gif of a web
UI that can start on localhost. Prefer it over hand-filmed Loom-style capture when the demo should
live in git and stay current via CI.

Do **not** use it for native apps, pure API demos with no UI, or spoken voiceover.

## Install into another project

```bash
npm i -D @pesuto/demotale
npx demotale init --agent
npx demotale doctor
```

That install pulls Playwright, Chromium (postinstall), and a bundled ffmpeg fallback. Needs Node
22.12+. If Chromium or ffmpeg is missing (for example `npm i --ignore-scripts`), run
`npx demotale setup`.

## How to write the demo

After install, **do not invent a scenario from memory**. Run:

```bash
npx demotale agent-guide
```

Follow that page. Short version of the loop: point `demotale.config.ts` at the real app → write
`demo/<thing>.demo.ts` → `npx demotale check --json` → open the frames → `npx demotale record` once.

## This repository

Working direction for contributors is in `.plan/KOERS.md` (gitignored Dutch notes). Public docs are
under `docs/`. Machine-readable index: [`llms.txt`](llms.txt).
