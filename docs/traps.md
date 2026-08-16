# Traps

Everything here was measured, not reasoned about. It comes from the recorder demotale grew out of and
from the sessions that used it to film a real application. Anyone building this from scratch hits
these in roughly this order and loses evenings to them, so they are written down whether or not you
use this package.

Where it says demotale handles something, that is what the code does about it.

## The overlay

**Content Security Policy refuses the overlay, and you find out in the first video.** The application
sent `style-src 'self'`, so the `<style>` element the overlay injects was blocked. The first take had
every subtitle as bare text at the bottom of the page, no cursor, no highlight.

→ demotale sets `bypassCSP: true` on the recording context. That is a property of the browser doing
the filming, not of the application: the served headers are unchanged, and what the CSP is for gets
measured where that belongs rather than in a video.

**The overlay has to be re-injectable.** An SPA navigation or a full reload throws it away.
`addInitScript` covers new pages but not the one already open, so a direct `evaluate` is needed too,
plus a guard (`if (window.__demo) return`) so injecting twice does nothing. Check before every action.

**It has to stay the last child of `body`.** Applications append modals and toasts to the end of
`body`, and those land on top of the subtitle otherwise. Re-appending before each action costs nothing
and fixes it permanently.

**It must not catch input.** `pointer-events: none !important` on the layer *and* everything inside
it. Otherwise the subtitle swallows the click meant for the button underneath.

**The subtitle belongs at the top.** On a dashboard the bottom is exactly where new rows appear, and
then the subtitle covers what it is pointing at.

**You have to draw the cursor yourself.** Playwright's video does not capture the operating system's
pointer. Draw it from real `mousemove` events, with a pulse on `mousedown`.

**And you have to move the mouse there.** Without `mouse.move(..., { steps: 22 })` and a short pause,
the cursor appears on the target out of nowhere. That reads as a script, not as a person.

## The spotlight

**Scroll first, measure second.** `boundingBox()` is viewport-relative and answers for an element
below the fold as well. Three spotlights in a row were drawn off screen because of this, and the video
showed a dimmed page with nothing marked on it. Scrolling is also what a person does before pointing.

**Then wait.** Some applications scroll smoothly, and a box measured halfway through that movement
frames empty space. About 450 ms is enough.

## The recording

**Set retries to zero.** A second attempt produces a second video, and the renderer must not have to
guess which of the two is the good one. A failed recording is one you run again.

**Never wait on an element that may never appear.** A recording once waited on a panel that a product
defect meant never arrived, and burned the full fifteen-minute test budget with a completely
provisioned environment around it. Assert existence with a short explicit timeout before pointing at
something, and a missing panel becomes a sentence within seconds.

→ demotale gives `spotlight` and `click` their own short timeouts, and `doctor` warns when the global
timeout is far larger than a scenario could plausibly need.

**Navigate by clicking, not by loading a URL.** A bundle referenced its assets relatively and the app
had no `<base href>` (its CSP set `base-uri 'none'`), so loading `/orders/42` directly asked the
server for `/orders/main-*.js` and nothing started. Clicking is what a person does anyway.

→ Rule of thumb: one full page load per recording, at the start, everything else through the
interface.

**Record against fresh state.** A recording against an environment somebody left running is a
recording against unknown data. One such run had an order already open for the demo record, so the
application correctly refused to start a second one, and the video showed a refusal.

→ demotale passes Playwright's `webServer` through, so the application is stood up per recording. The
docs call that a condition rather than tidiness.

**Check everything that can be missing in the first ten seconds.** ffmpeg, browsers, reachability,
credentials. One recording failed after the setup and part one, twenty minutes in. That is what
`demotale doctor` is.

## Rendering

**Playwright records at a variable frame rate and in a different colour format.** Without
`-vf fps=30,format=yuv420p`, QuickTime and PowerPoint refuse the file. Then `libx264`, `crf 23`,
`-movflags +faststart`.

**Playwright names the video directory itself.** The name you want has to be put beside it: the
fixture writes a `demo-meta.json` into the output directory and the renderer reads it and renames.

**Joining two parts needs no re-encoding.** Both come from the same recorder, so same size and frame
rate, and the concat demuxer with `-c copy` is enough. A second of work, no quality lost. Note that
the demuxer wants absolute paths in its list file.

**Missing ffmpeg must not break anything.** The webm stays, the renderer says in one sentence what is
missing and how to install it, and exits zero.

**A gif of a full viewport is enormous.** 1440 pixels wide at 15 frames a second came out at nine and
a half megabytes. Cap the width and halve the frame rate, and generate a palette from the recording:
the default 256-colour palette bands badly on the flat colours interfaces are made of.

## Signing in

This is where the most time went, and where there are the most ways to believe it worked when it did
not. The original script had three defects, and they cost a person three separate logins before they
were understood.

**The absence of a "sign in" link is not evidence of a session.** The first version waited for that
link to disappear. An identity provider's login page has no "sign in" link either, so the check passed
a second after the browser opened and stored the negotiation cookies as though they were a session.
Wait for a positive answer, not for the absence of something.

**Ask the page, not Node.** Measured: the same request through `context.request`, which shares the
cookie jar but not the origin, did not once answer for a browser that was demonstrably signed in,
avatar on screen and the list rendered. A `fetch` from inside the page is the call the application
itself makes.

**Save the moment it is real, not at the end.** Somebody signed in, saw the page they expected, closed
the window, and the script was still in its polling loop: the login was good and nothing was ever
written. Everything after the first save is an improvement on a file that already exists.

**Accept a window that rests on the right address.** The identity check is the better signal when it
comes, but once it did not come at all while everything was fine. A window that stays on a private
environment's own URL for fifteen seconds is already what a recording needs, and the file gets tested
afterwards regardless.

**Test the stored file in a fresh browser before saying it works.** Load the target page with nothing
but that file as state and see where you land. If it does not work, delete it rather than let it fail
a recording that is already twenty minutes in.

**Same origin is not the same thing as signed in.** Landing back on `/login` of the application
itself passes an origin check and means the session is dead. Compare against a browser with no
session at all: if both end up in exactly the same place, the stored file changed nothing.

**A probe must not follow redirects.** Applications commonly answer an unauthenticated API call with
a redirect to a login page, and that page returns 200. Following it reports success for a browser that
is not signed in, which is the missing-sign-in-link mistake again in a different coat.

**Do not hang the waiting loop off the page.** `page.waitForTimeout` throws the moment the window
closes, which turns a person shutting their browser into a stack trace instead of a sentence.

**Say what the file is.** It is a browser session for a real account, in plain JSON, on disk. It
belongs in `.gitignore`, and it is a credential.

## Privacy on screen

**"We do not click on it" is a promise about a script; hiding it is a fact about the picture.** In the
source project the organisation switcher and the account menu were hidden with a style tag, because
those are the two places that would have listed the owner's other customers. A click path gets edited
later by somebody else. A hidden element does not.

→ This is `redact` in the config: selectors hidden for the whole recording, applied before the first
frame and again after every navigation. For anyone filming a real tenant it is the difference between
publishing and not.

## Pace and text

**One knob for pace, and it touches only the pauses.** Scaling every wait leaves the application
alone. 1.4 is calmer, 0.7 is shorter.

**Reading time can be calculated.** About fifteen characters a second, floor 1.9 seconds, ceiling 9.
Good enough in practice for Dutch and English subtitles alike.

**Show the text before the action and leave it up during it.** Then the viewer knows what they are
looking at instead of what they have looked at.

## Attitude

**A demo that overstates is worse than no demo.** Where a recording showed something that was not
real, the caption said so in as many words. The only thing a demo is for is establishing where things
actually stand.

→ That is also positioning, not only ethics: a tool that makes it easy to mark what is mocked is a
tool you dare put in front of a customer.

**No spoken commentary.** A narrated video has to be re-recorded by a person on every change; text
overlays roll out again by themselves. That is the reason this whole thing exists.
