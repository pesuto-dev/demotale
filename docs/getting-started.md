# Getting started

From nothing to a video, in the order it actually happens.

## What you need

- Node 22.12 or later. Below that Node cannot read a TypeScript config file without a build step,
  which is what makes `demotale.config.ts` work.
- An application you can start locally.

Playwright and Chromium come with `@pesuto/demotale`. Put ffmpeg on PATH
(`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`), or add
`npm i -D ffmpeg-static`. Without any ffmpeg a recording still runs and leaves you a webm.

## Install

```bash
npm i -D @pesuto/demotale
npx demotale init --agent
npx demotale init --ci
```

`init` writes four things and overwrites none of them:

| | |
| --- | --- |
| `demotale.config.ts` | Where your app runs, how fast the demo goes, what is never in frame |
| `playwright.config.ts` | Generated from the above. Not meant to be edited |
| `demo/example.demo.ts` | A scenario that records the front page |
| `.gitignore` lines and npm scripts | Including `.auth/`, which holds a credential |

With `--agent` it also appends five lines to `AGENTS.md` that point at `npx demotale agent-guide`.
With `--ci` it writes `.github/workflows/demotale.yml` if that file is not already there.

If install scripts were skipped, or doctor reports a missing browser: `npx demotale setup`.

## Point it at your app

Open `demotale.config.ts` and change two things:

```ts
baseUrl: 'http://localhost:4200',
webServer: {
  command: 'npm start',
  url: 'http://localhost:4200',
  reuseExistingServer: false,
},
```

`reuseExistingServer: false` is deliberate. A recording made against an environment somebody left
running is a recording against unknown data, and that has produced a video of an application
correctly refusing to do the thing the video was about.

## Check the machine

```bash
npx demotale doctor
```

Ten seconds, one line per thing, and a sentence for anything that is missing. Worth running before
the first recording rather than after twenty minutes of one. It installs nothing. Missing Chromium
is `npx demotale setup`. Missing ffmpeg is a system install, or `npm i -D ffmpeg-static`.

## Record

```bash
npx demotale record
```

It starts your app, plays the scenario, and renders. You end up with:

```
demo/output/
  raw/                      the webm Playwright wrote, and the sidecar
  a-first-recording.mp4
  a-first-recording.vtt     subtitles
  a-first-recording.md      transcript with timestamps
```

Add `gif` to `video.formats` in the config for a gif as well.

## Watch it being made

```bash
npx demotale record --headed
```

The browser is visible while it works. Useful the first few times, and for finding out which of your
selectors does not match what you thought.

## Then

- [Writing a scenario](writing-a-scenario.md) for what to put in the file.
- [Recipes](recipes.md) if your app needs a login, if the demo has a long wait in the middle, or if
  you want CI to keep the video current.
