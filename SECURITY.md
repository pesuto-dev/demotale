# Security

## Reporting something

Please report a vulnerability privately through GitHub's
[security advisories](https://github.com/pesuto-dev/demotale/security/advisories/new) rather than in a
public issue. You will get an answer within a week.

## What this package touches

demotale drives a browser against your application and writes video files. Three parts of that are
worth knowing about.

### The stored session is a credential

`demotale auth` writes a signed-in browser session to disk, by default `.auth/session.json`. It is
plain JSON containing cookies and local storage for a real account. Anyone with that file has that
account until the session expires.

`demotale init` adds `.auth/` to your `.gitignore` and says why in the file. If you put such a session
in CI, use an account you would be comfortable seeing leaked, and prefer a short-lived one.

If the verification step after signing in fails, the file is deleted rather than left on disk.

### bypassCSP is on during a recording

The recording browser runs with `bypassCSP: true`, because the overlay injects a `<style>` element and
any application sending `style-src 'self'` refuses it.

This is a setting on the browser doing the filming. Your application's headers are unchanged, nothing
is served differently, and no other browser is affected. It does mean the recording browser is not
enforcing your CSP, so treat a recording session the way you would treat a browser with an extension
loaded: do not use it for anything except recording, and do not point it at a site you do not trust.

### Video shows whatever is on screen

A recording captures the viewport, including anything the click path happens to pass. `redact` in the
config hides elements before the first frame and again after every navigation, which is the mechanism
to use for account menus, tenant switchers, customer names and anything else that must never appear.

"The script does not click on it" is not the same guarantee: scripts get edited later, by other
people. If it must not be in the video, redact it.

## Supported versions

Until 1.0, only the latest published version gets fixes.
