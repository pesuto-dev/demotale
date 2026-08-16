import { definePlaywrightConfig } from '@pesuto/demotale';
import config from './demotale.config.js';

// Do not hand-write this. definePlaywrightConfig pins the settings a recording depends on:
// bypassCSP for the overlay, no retries so there is only ever one video, and one worker.
export default definePlaywrightConfig(config);
