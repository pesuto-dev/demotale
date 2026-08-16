import { defineConfig } from '@pesuto/demotale';

export default defineConfig({
  // Where your app runs. The recording opens this once and clicks from there.
  baseUrl: 'http://localhost:3000',

  scenarios: './demo',
  output: './demo/output',

  viewport: { width: 1440, height: 900 },

  // Scales every pause in the scenario. It never touches your application.
  speed: 1,

  // Milliseconds between Playwright actions, so a click is watchable.
  slowMo: 120,

  // Passed to Playwright unchanged. Record against a fresh app, not against whatever
  // happened to be running: leftover state is the most common reason a demo lies.
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
  },

  // Written by `demotale auth <url>`. Missing is a supported state.
  // This file is a credential. Keep it out of git.
  storageState: '.auth/session.json',

  // Never in frame, whatever the click path does.
  redact: [],

  video: { fps: 30, crf: 23, formats: ['mp4'] },
  captions: { vtt: true, transcript: true },
});
