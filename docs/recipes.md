# Recipes

## An app behind a login

Some applications cannot be signed into with a token. They want a real browser session, negotiated by
a person with an identity provider. Do that once:

```bash
npx demotale auth https://app.example.com/private --out .auth/session.json
```

A browser opens. Sign in the way you normally would. The command watches, and writes the session out
the moment it has evidence you are through. Then it closes that browser, opens a fresh headless one
with nothing but that file, and loads the page again.

That test has three outcomes, not two:

| | |
| --- | --- |
| `verified:` | The session works. Either the probe answered, or the page landed somewhere an anonymous browser does not reach |
| the file is deleted | It does not work: the browser was sent to another origin, or the probe did not answer. Better to find out now than twenty minutes into a recording |
| `cannot tell` | A browser with the session lands in exactly the same place as one without. That is what a single-page app rendering its own login screen looks like, and also what a dead session looks like. The file is kept, unverified, and `--probe` will settle it |

Point the config at the file:

```ts
storageState: '.auth/session.json',
```

Missing is a supported state. Everything that films a public part of your app works without one.

### Making the check stricter

By default the command accepts a window that rests on the target origin for fifteen seconds. If your
app has an endpoint that answers only for a signed-in user, name it and the check becomes exact:

```bash
npx demotale auth https://app.example.com/private \
  --probe /api/me \
  --verify https://app.example.com/orders \
  --settle 20s \
  --timeout 15m
```

The probe is fetched **from inside the page**, which is the same call your front end makes. Asking
from Node instead shares the cookie jar but not the origin, and in practice never answered for a
browser that was demonstrably signed in.

Redirects do not count. Plenty of applications answer an unauthenticated API call with a redirect to
a login page, and that page returns 200; following it would turn "you are not signed in" into a
success. The probe request does not follow redirects for exactly that reason.

### That file is a credential

It is a signed-in browser session for a real account, in plain JSON, on disk. `demotale init` puts
`.auth/` in your `.gitignore` and says why. Do not put it in CI unless the account is one you would
be comfortable seeing leaked.

## A recording in two parts

Some demos have a wait in the middle that nobody should sit through: a build, a deployment, a batch
that takes four minutes. Record two scenarios, and join them:

```bash
npx demotale record demo/part-1.demo.ts
npx demotale record demo/part-2.demo.ts
npx demotale join demo/output/part-1.mp4 demo/output/part-2.mp4 demo/output/full.mp4
```

Both parts come out of the same recorder at the same size and frame rate, which is exactly the
condition under which the join is a stream copy: no re-encoding, no quality lost, about a second.

Open part two with a card that says how long the wait really was. Cutting time out silently is the
thing that makes a demo feel like an advertisement.

## Keeping the video current in CI

The reason for all of this is that a recording made by hand goes stale at the first UI change. Let CI
make it again. `npx demotale init --ci` writes the workflow below, and never overwrites one that is
already there. `doctor` names that command when the file is missing:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: sudo apt-get update && sudo apt-get install -y ffmpeg
- run: npx demotale record
- uses: actions/upload-artifact@v4
  with:
    name: demo
    path: demo/output/*
```

Three things to know. `@pesuto/demotale` already depends on Playwright; `--with-deps` is for the OS
libraries Chromium needs on Linux runners (the browser binary itself usually arrived at `npm ci` via
postinstall). GitHub-hosted Ubuntu does not ship ffmpeg; without it the recording stays a webm.
And a recording that fails is a build that goes red, which is the point: it means the click path no
longer matches the application, and the video would have been wrong.

## A gif for your README

```bash
npx demotale gif
```

Or list it in the config if CI should always produce one:

```ts
video: { formats: ['mp4', 'gif'], gifWidth: 720, gifFps: 10 },
```

A gif of a full 1440-pixel viewport at 15 frames a second comes out around nine megabytes. Capped at
720 and 10 it is closer to two, which is what a page at the top of a repository can carry. `gifWidth`
defaults to 960 and `gifFps` to 15. A gif of 8 MB or more says so when it is written.

`demotale gif` reuses the last recording when there is one, so `video` then `gif` does not play the
click path twice. Name a scenario file and it records that one instead of reusing.

## Docs pictures

Mark the moment in the scenario after the assertion that proves the screen is what the docs claim:

```ts
await expect(page.getByRole('heading', { name: 'Order' })).toBeVisible();
await demo.still('order-open');
```

Then ask for exactly that many pictures. The number is a promise: a different count or a repeated
name writes nothing, so a docs folder cannot go out with a hole in it.

```bash
npx demotale images 1
```

You get `demo/stills/01-order-open.png` (numbering is on by default; `stills.number: false` turns it
off). That folder belongs in git. The overlay is hidden for the shot; `redact` stays. ffmpeg is not
needed. During `video` or `record`, `still()` does nothing, so the same scenario can film and
illustrate.

## Subtitles and a transcript

On by default:

```ts
captions: { vtt: true, transcript: true },
```

The `.vtt` sits next to the mp4 and any player will pick it up. The `.md` is a timestamped transcript,
which is what makes the demo searchable, quotable, and readable by somebody who cannot watch video.

## Someone else's colours

```ts
theme: {
  base: 'light',
  accent: '#ff5a1f',
  captionPosition: 'top',
  badge: false,
},
```

Two themes ship, `dark` and `light`. Both are ordinary objects, so you can also import one and spread
it. `captionPosition` is the preferred edge (`'top'` or `'bottom'`, default `top`). `captionOffset`
is the distance from that edge, 64 by default. When a spotlight would sit under that bar, the overlay
flips to the other side until the ring clears. A standing `note()` sits in the opposite corner and
moves if the spotlight would cover it. `bottom` exists, but on a dashboard that is where new
rows appear.

## The scenario starts the app

Some recordings have to stop the server in the middle: an offline moment, a restart, a "connection
lost" indicator. `webServer` starts the application once and holds it for the whole run, so the
scenario does it instead, from `test.beforeAll` and from inside a step.

```ts
webServer: false,
```

Doctor then warns if `baseUrl` is down, and does not fail. A recording will not start the server
for you. The scenario is a Playwright test, so `createServer` (or stopping and starting whatever
you already use) works the same way it would in any other test.

## Recording against a different port

```bash
npx demotale record --port 3100
```

This moves the browser and your `webServer` together, and passes `PORT` to the server command. A port
flag that moved only the browser would leave Playwright waiting on the old port and filming whatever
else was listening there.
