# Changelog

Notable changes, newest first. This project follows [semantic versioning](https://semver.org/) from
0.1.0 onwards.

## 0.1.0 — 2026-08-10

The first version. Lifted out of a project-internal recorder and made configurable, with the things
that recorder taught us built in rather than rediscovered.

Install is one package: `npm i -D @pesuto/demotale` pulls Playwright, downloads Chromium on postinstall,
and falls back to a bundled ffmpeg (via `ffmpeg-static`) when none is on PATH. `demotale setup`
recovers when install scripts were skipped. `doctor` still installs nothing.

### The recording

- `Demo` API: `card`, `say`, `step`, `spotlight`, `click`, `type`, `pause`, `hide`.
- `note()` for a standing label, so a recording can say what is seeded or stubbed and keep saying it.
- `wait(label, promise)` for a long wait worth naming; the transcript records how long it really took.
- `chapter()` for a marker that appears only in the transcript and the subtitles.
- `redact()` for taking one element out of the picture, and `redact` in the config for the elements
  that must never be in it.
- The overlay is themable: two themes ship, and colours, font, subtitle position and the step badge
  all come from config.

### Output

- mp4, with the flags QuickTime and PowerPoint insist on.
- gif, palette-generated and capped in width, sized for a README rather than for fidelity.
- `.vtt` subtitles and a markdown transcript, written from the lines the scenario already had.
- `join` for two parts, as a stream copy: no re-encoding, no quality lost.

### The command line

- `init`, which never overwrites anything. With `--agent` it appends five lines to AGENTS.md that
  point at `demotale agent-guide`. The `.gitignore` lines it writes put each reason on its own line
  above its pattern: gitignore has no trailing comments, and written the other way round the whole
  string is the pattern, matches nothing, and `.auth/` — a browser session for a real account, in
  plain JSON — was not ignored at all. Running init again in a project that got the broken version
  adds the working lines beside the dead ones.
- `setup`, which downloads Chromium for demotale's Playwright and verifies ffmpeg (PATH or bundled)
  when postinstall did not run.
- `agent-guide`, one page of instructions for whatever writes the scenarios. Every line in it is a
  mistake an agent made in a trial with no instructions: the placeholder config nobody changed, the
  redaction nobody thought of, the green baseUrl that was somebody else's application, and the
  recording used as a way to find out whether a locator works. It is a command rather than a
  document so that it cannot go stale in someone else's repository and costs no context until a
  demo is actually wanted.
- `check`, the dry run: the same click path and the same fixture, without the video and without the
  reading pauses, writing a frame per subtitle at the moment the subtitle is up. When a locator
  misses it says which step, what it asked for, and what the page held instead, ranked by how close
  it is. Its frames and reports go in `demo/output/check`, never near the recording. When the page
  it ended up on looks like a sign-in it says so first, because otherwise the report blames a
  locator that is fine. `--base-url` points a run somewhere else for one run, which is how you check
  a scenario against a copy of the app without editing the config and remembering to put it back.
- `--json` on `check`, `record`, `render` and `doctor`. One envelope for all four
  (`{ demotale, command, ok, problems, result }`), so whatever wrote the scenario can read what to
  change without parsing terminal text. `problems` is always there and always the short version:
  the sentence, the scenario, the step, the locator, and a command to run where a command helps.
  In JSON mode stdout carries the document and nothing else, Playwright's own output included.
  Every problem carries a stable `code`, so classifying one never means matching English prose, and
  every payload echoes the settings the run actually used, so "did my edit take effect" is a fact
  rather than an inference. Assertion failures keep the same shape as locator failures, with the
  escape codes taken out of Playwright's message and the locator lifted out of its sentence.
- `record`, which records and renders in one go.
- `render`, `join`.
- `auth`, which waits for a positive answer, saves the moment a session is real, and then verifies the
  stored file in a fresh browser before claiming it works. Verification has three outcomes: it works,
  it does not and the file is deleted, or it cannot be told apart from an anonymous visit and the file
  is kept with that said out loud.
- `doctor`, which checks everything that can be missing in ten seconds and answers each thing with
  the command that fixes it. It verifies that `webServer.command` names a script this project
  actually has, listing the ones it does have when it does not; that `baseUrl` and `webServer.url`
  are the same address; and that the config was ever pointed at anything, since a still-default
  `baseUrl` next to a command that does not resolve means whatever answers that port belongs to
  somebody else. It asks for `baseUrl` without following redirects, so an application that sends the
  browser to a sign-in is reported as needing `demotale auth` rather than as a healthy 200. It
  starts nothing and installs nothing.

### Requirements

- Node 22.12 or later. Below that Node cannot strip types from a `demotale.config.ts`, and a
  CommonJS project cannot load this ESM-only package at all.
- `@playwright/test` and `ffmpeg-static` as dependencies of `@pesuto/demotale`. A project may still
  install its own Playwright; demotale prefers that copy when present.
- ffmpeg: system binary on PATH when available, otherwise the bundled `ffmpeg-static` build (see
  NOTICE). Without either, a recording still runs and leaves the webm.
