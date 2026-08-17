# Contributing

Issues and pull requests are welcome. This is a small package with a narrow purpose, so the most
useful contributions are usually a recording that went wrong and the reason why.

## Getting set up

```bash
npm install
npx playwright install chromium
npm run typecheck && npm test && npm run build
npm run example        # records examples/basic end to end
```

You need Node 22.12 or later and ffmpeg on your PATH.

## What the code is trying to be

**Measured, not reasoned about.** Nearly every non-obvious line here exists because a recording went
wrong in a specific way. If you change one of those, please check the comment above it first, and if
the comment turns out to be wrong, say so in the commit message. An assumption written down as fact
costs somebody an evening later; [docs/traps.md](docs/traps.md) is the list of times that already
happened.

**Small.** This wraps Playwright and ffmpeg. It is not a video editor, it will not grow a timeline, and
it will not gain a hosted service. Audio and text-to-speech are out of scope for v1 on purpose: a
narrated video has to be re-recorded by a person on every change.

**Honest.** Features that make it easier to overstate what an application does will not be added.
Features that make it easier to say what is seeded, stubbed or hidden will be.

## Conventions

- Code, comments, documentation and commit messages are English.
- Comments explain why, not what. If a line is only doing what it says, it does not need one.
- Commit messages say what changes and why, not which files.
- Every public function has a doc comment aimed at somebody who has not read the rest of the file.

## Tests

`npm test` runs vitest. Unit tests only; the end-to-end proof is `npm run example`, which records the
example application and is what CI runs.

A test earns its place by pinning down something that could plausibly regress and would be hard to
notice: which files end up in the published tarball, that the overlay still refuses pointer events,
that a config error names the key. Tests that restate the implementation are not worth their upkeep.

## Reporting a recording that went wrong

Please include what you would want if you were fixing it:

- what the application does that the recording did not expect,
- the output of `npx demotale doctor`,
- the scenario, or the few lines of it that matter,
- and the video or a frame from it, if you can share one.

## License

By contributing you agree that your contribution is licensed under the Apache License 2.0, the same
as the rest of the project. The Pesuto name and logo are not covered by that license.
