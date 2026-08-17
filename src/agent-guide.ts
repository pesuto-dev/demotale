/**
 * What `demotale agent-guide` prints, and the few lines in AGENTS.md that point at it.
 *
 * Everything here was measured. Two agents were given a repository, one sentence and no help, and
 * every place they guessed, over-recorded or got something wrong is a line below. The rules that
 * sound obvious are the ones nobody followed unprompted; the rules that sound fussy cost somebody an
 * afternoon.
 *
 * The reason this is a command and not a document in the repository: instructions that live in
 * somebody else's repo go stale the moment they upgrade, and instructions pasted into a prompt cost
 * context on every task whether or not a demo is wanted. Five lines that say "run this" cost almost
 * nothing and can never disagree with the installed version.
 */
import { createRequire } from 'node:module';

const version = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/** Marks the block in AGENTS.md, so a second `init --agent` leaves it alone. */
export const AGENTS_MARKER = '<!-- demotale:agent-guide -->';

/** The five lines. Deliberately short: their whole job is to point somewhere that cannot go stale. */
export function agentsBlock(): string {
  return [
    AGENTS_MARKER,
    '## Recording a demo',
    '',
    'This project records demo videos of itself with demotale. When you are asked for a demo, a',
    'recording or a screencast of anything here, run `npx demotale agent-guide` first and follow',
    'what it prints. It is one page, it is written for you rather than for a person, and it is part',
    'of the installed version, so it cannot be out of date. Do not write a scenario from memory.',
  ].join('\n');
}

export function agentGuide(): string {
  return `demotale ${version} — writing a demo, for an agent

A scenario is a Playwright test that happens to be watchable. You write it, a dry run tells you what
is wrong in seconds, and one recording at the end turns it into an mp4 with subtitles and a
transcript. Everything below was learned by watching agents do this without instructions.

THE LOOP
  1  npx demotale doctor --json          what is missing, and the command that fixes it
  2  point the config at the real app    the one step nobody can do for you
  3  write demo/<thing>.demo.ts          one sentence per step
  4  npx demotale check --json           seconds, no video, a frame per subtitle
  5  open the frames                     really open them; a green check proves less than you think
  6  npx demotale record                 once, at the end

Do 3 to 5 as often as needed. Recording to test a locator is slower and tells you less than \`check\`.

WHAT TO FILM
  Work it out from the repository. Read the branch and the diff: \`git diff\`, the files that changed,
  the component, its markup, its handles. Visible text is often not in the template: a framework app
  keeps it in a translation file, so grep the string catalogue for the button. Do not open a browser
  to explore, and do not record to look around; both are slower than the source you already have.
  If the sentence names something the diff does not contain, film it anyway and say on screen which
  part is not real yet.

POINT IT AT THE REAL APP
  Edit \`demotale.config.ts\`. \`init\` writes \`baseUrl: 'http://localhost:3000'\` and
  \`webServer.command: 'npm start'\`; both are placeholders and both are usually wrong. Find the truth
  in the project itself: the dev script in package.json, the port in the server's own source.
  \`baseUrl\`, \`webServer.url\` and \`webServer.command\` are three settings for one thing and must
  agree. \`doctor\` checks all three and says which is wrong, so run it after the edit rather than
  reasoning about it.
  What \`doctor\` cannot know is whether the program answering that address is yours. After a check,
  read \`result.scenarios[].pages\` in the JSON, or the \`filmed\` lines in the text: the address and
  the page title that ended up on film. Measured: a green check that had filmed an unrelated server.

HIDE WHAT MUST NOT BE FILMED
  Fill \`redact\` in the config before you record: the account name, the email address, the tenant or
  organisation switcher, anything naming a customer. Those selectors are hidden for the whole
  recording, before the first frame and again after every navigation.
  If something internal is in frame and you cannot tell whether it may be published (a desk, a
  depot, a site code), redact it and say you did. Redaction is reversible; a published video is not.
  Nobody does this unprompted, which is why it is here. "We do not click on it" is a promise about a
  click path that somebody will edit later; a hidden element is a fact about the picture.

WRITING THE SCENARIO
  Open on a title card, then one \`page.goto('/')\`, then \`hideCard()\`. After that, click: loading a
  deep URL asks the server for assets relative to that path, and a single-page app often loads nothing at all.
  A step is one sentence, not a paragraph. It goes up before the action and stays up during it.
  Assert before you point. \`await expect(x).toBeVisible()\` with a short timeout, then spotlight it:
  waiting on something that will never appear should cost seconds, not the whole test budget.
  Assert the end state, not the first element to render: a heading is on the page before its rows.
  Write assertions that would fail on the wrong page. \`expect(page).toHaveTitle(/./)\` passes on
  anybody's login screen, and a green run against the wrong application is the worst output there is.
  Locate by role and accessible name, \`getByRole('button', { name: 'Filter' })\`, and by test id only
  where one exists: most applications have none, and a CSS class breaks on the next restyle.
  \`spotlight\` frames exactly the element you give it. If the handle sits on the number, you get a
  framed number with its label cut off; point at the container instead. When the container has no
  handle of its own, reach it through a child, which takes a role as readily as a test id:
      page.locator('.tile', { has: page.getByRole('heading', { name: 'With priority' }) })
  Keep a step short enough to stay on one line. A longer sentence wraps, and the second line lands on
  the page underneath. The check frames are where you see it.
  \`chapter()\` is synchronous and paints nothing. Everything else is awaited.
  Delete the \`demo/example.demo.ts\` that \`init\` wrote; \`record\` films every \`*.demo.ts\` it finds.
  The output file is named after the \`test('...')\` title, not after the file.

DATA, AND SAYING WHAT IS NOT REAL
  A filter over three rows demonstrates nothing. If the demo needs data, put the seeding in a
  \`*.prepare.ts\` beside the scenario: it runs first, in the same browser, and is not filmed. Nobody
  wants to watch seeding, and unknown leftover state is how a demo comes to lie.
  Seed through the application, never by editing it. Where there is no seam (data hardcoded in a
  service, a stubbed frontend), film what is there and label it instead.
  \`demo.note('Stubbed depot data, no real parcels')\` puts a standing label in the corner for the
  whole recording. Use it whenever what is on screen is not what it appears to be: mocked, seeded,
  made up. A demo that overstates is worse than no demo, and this is the cheapest way to be honest.

CHECKING YOUR OWN WORK
  \`check\` writes a PNG per subtitle: when the subtitle goes up, once a spotlight is drawn, and once
  the step has finished rather than when the click landed, so a step that waits for data shows the
  data. Each is the same picture the video will show then. Open them and look: does the subtitle sit
  on top of the thing it points at, is the right element framed, is the label cut off, did the step
  change what it claims to change. None of that is visible in an exit code.
  They show moments, not movement: pacing and pointer travel need the recording itself.
  Re-run \`check\` after every locator change. \`record\` will not tell you a spotlight is framing the
  wrong box; it will film it.
  When a locator misses, the report says what was on the page instead, closest first, with roles,
  accessible names and test ids. Fix from that list rather than by guessing again.

READING THE OUTPUT AS DATA
  \`check\`, \`record\`, \`render\` and \`doctor\` all take \`--json\` and all answer the same shape:
  \`{ demotale, command, ok, problems, result }\`. Start at \`problems\`: each has a stable \`code\`
  (\`locator-no-match\`, \`assertion-failed\`, \`wrong-origin\`, \`missing-ffmpeg\`, ...), the scenario, the
  step, the locator, and a \`fix\` command where a command is the answer. \`result\` has the detail:
  candidates, frame paths, the pages that were filmed, and the settings the run actually used.

WHEN SOMETHING IS MISSING
  \`doctor\` names the \`fix\` command and installs nothing itself. Missing Chromium: \`npx demotale setup\`.
  Missing ffmpeg: a system install, or \`npm i -D ffmpeg-static\`. Run those only if the person asked:
  installing because a tool suggested it is how people come to distrust tools.
  When it reports \`needs-login\`, the application sent the browser to a sign-in and the fix is
  \`demotale auth <url>\`, which opens a browser and waits for a human. That is a person's job, not
  yours: say it is needed and stop.

WHEN YOU ARE DONE
  Say what you changed and leave it for the developer to commit. The scenario belongs in the
  repository — thirty lines that CI can run again tomorrow (\`init --ci\` writes the workflow) — and \`demo/output/\` does not; it is a
  build artefact and \`init\` gitignores it.
  Aim for under a minute and five to eight steps: past that a demo stops being watched. \`record\`
  plays in real time and costs about the length of the video; \`check\` takes seconds.
`;
}
