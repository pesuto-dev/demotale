# Writing a scenario

A scenario is a Playwright test with one extra fixture. Everything you already know about Playwright
applies: locators, `expect`, fixtures, `test.describe`. What `demo` adds is the part a viewer sees.

```ts
import { test, expect } from '@pesuto/demotale';

test('From an order to a shipped parcel', async ({ page, demo }) => {
  await page.goto('/');
  // ...
});
```

The test title becomes the file name, slugged. `From an order to a shipped parcel` gives you
`from-an-order-to-a-shipped-parcel.mp4`.

## Shape of a good scenario

**One full page load, at the start.** After that, navigate by clicking. Loading a deep URL directly
asks the server for assets relative to that path, and in a single-page app without a `<base href>`
that loads nothing at all. Clicking is also what a person does.

**Say it before you do it.** `step()` shows the text, waits until it can have been read, and only then
runs the action, leaving the text up while it happens. The viewer then knows what they are watching
rather than what they have just watched.

**Assert before you point.** `spotlight()` and `click()` wait ten and fifteen seconds respectively and
then fail with a sentence. If something might genuinely not be there, assert it yourself with a short
explicit timeout first. Never wait on an element that may never appear: that once burned a
fifteen-minute budget with a fully provisioned environment around it.

**Keep it under two minutes.** Nobody watches more. If the story is longer, record it in two parts and
[join them](recipes.md#a-recording-in-two-parts).

## The methods

### Text

```ts
await demo.card('Acme', 'From an order to a shipped parcel');  // full-screen title card
await demo.hideCard();

await demo.say('Someone picks the order. Nothing here happens by itself.');
await demo.say('Only for a moment.', { hold: 1200 });          // override the reading time
await demo.hide();
```

Reading time is calculated from the length of the line: about fifteen characters a second, never
under 1.9 seconds and never over 9. That has held up for Dutch and English subtitles alike.

### Steps

```ts
await demo.step('Opening it fetches the order live.', async () => {
  await demo.click(page.getByRole('link', { name: 'Open' }));
  await expect(page.getByRole('heading', { name: 'Order' })).toBeVisible();
});
```

Steps are numbered on screen, in a badge in front of the subtitle. Turn the badge off in the theme if
you would rather not have numbers.

### Pointing at things

```ts
await demo.spotlight(page.getByTestId('cache-age'), 2400);   // frame it, dim the rest, hold
await demo.clearSpotlight();

await demo.click(page.getByRole('button', { name: 'Start' }));
await demo.type(page.getByLabel('Order number'), 'PD-1041');
```

`spotlight` scrolls to the element before it measures. `boundingBox()` is viewport-relative and
answers for elements below the fold too, so measuring first draws the frame off screen and the video
shows a dimmed page with nothing marked on it.

`click` moves the pointer there in steps and pauses before clicking, because a cursor that teleports
onto its target reads as a script rather than as somebody using the software.

### Being honest about what is on screen

```ts
await demo.note('Seeded data. No real customer.');
// ... it stays there ...
await demo.note();   // take it away
```

A demo that overstates is worse than no demo. Use this whenever what is on screen is not what it
appears to be: seeded data, a staging environment, a stubbed integration.

```ts
await demo.redact(page.getByTestId('customer-name'));
```

Takes one element out of the picture for the rest of the recording. For anything that must *never* be
in frame, use `redact` in the config instead: that is applied before the first frame and again after
every navigation. "We do not click on it" is a promise about a script, which someone will edit later.
Hidden is a fact about the picture.

### Long waits

```ts
await demo.wait('Building the container', someLongPromise);
```

Shows the label, waits for the real thing, and writes down how long it actually took. The transcript
then reads `Building the container (waited 3m 41s)`, which is the honest version of cutting it out.

### Chapters

```ts
demo.chapter('Approving the order');
```

Nothing appears on screen. It becomes a heading in the transcript and a marker in the subtitle file,
which is where somebody looking for one part of a long recording actually looks.

## Warming up off camera

A file named `*.prepare.ts` instead of `*.demo.ts` runs first and is not recorded. Put seeding,
sign-ins and any other preparation there, so the video starts on the story.

## Pace

```bash
npx demotale record --speed 1.4    # calmer
npx demotale record --speed 0.7    # shorter
```

One knob, and it only scales pauses. Your application is never sped up or slowed down, so nothing you
see in the video is a timing that does not happen in real life.
