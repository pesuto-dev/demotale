import { defineConfig } from '@pesuto/demotale';

export default defineConfig({
  baseUrl: 'http://localhost:4173',
  scenarios: './demo',
  output: './output',

  // Started fresh for every recording, so the video can never be of somebody's leftover state.
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },

  // The example is public, but the redaction is real: the account line is the kind of thing that
  // should not be in a video, and this proves the mechanism outside a test.
  redact: ['[data-testid="account"]'],

  // The gif is what goes at the top of the README, so it is sized for a web page rather than for
  // fidelity: full width and 15fps came out at nine megabytes.
  video: { formats: ['mp4', 'gif'], gifWidth: 720, gifFps: 10 },
  captions: { vtt: true, transcript: true },
});
