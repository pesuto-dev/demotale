/**
 * Post-production: Playwright's webm into a file that plays everywhere.
 *
 * Two things here are not taste. `fps=30,format=yuv420p` is required because Playwright records at a
 * variable frame rate in a colour format QuickTime and PowerPoint refuse; without it the mp4 exists
 * and simply will not open. And the file name has to come from a sidecar, because Playwright decides
 * for itself what to call the directory it drops the video in.
 *
 * Missing ffmpeg is not an error. The webm stays where it is and plays in any browser; the caller
 * gets told what is missing and how to install it. Prefer system ffmpeg, then the binary that ships
 * with demotale via ffmpeg-static.
 */
import fs from 'node:fs';
import path from 'node:path';

import { toTranscript, toVtt, type DemoMeta } from './captions.js';
import type { ResolvedConfig, VideoFormat } from './config.js';
import { hasFfmpeg, runFfmpeg } from './ffmpeg.js';

export { ffmpegInstallHint, hasFfmpeg, resolveFfmpeg } from './ffmpeg.js';

export interface Recording {
  /** Absolute path of the webm Playwright wrote. */
  webm: string;
  /** File name it should get, without extension, from the sidecar the fixture left behind. */
  name: string;
  /** What the scenario said and when, if the sidecar was written. */
  meta: DemoMeta | undefined;
  modifiedAt: number;
}

export interface RenderedFile {
  file: string;
  bytes: number;
}

export interface RenderResult {
  recordings: Recording[];
  files: RenderedFile[];
  /** Set when nothing was rendered because ffmpeg is not installed. */
  missingFfmpeg: boolean;
}

/** Every directory under the raw output that holds a webm, newest first. */
export function findRecordings(rawDir: string): Recording[] {
  if (!fs.existsSync(rawDir)) return [];

  const found: Recording[] = [];
  for (const entry of fs.readdirSync(rawDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(rawDir, entry.name);
    const webms = fs.readdirSync(dir).filter((file) => file.endsWith('.webm'));
    if (webms.length === 0) continue;

    const sidecar = path.join(dir, 'demo-meta.json');
    let name = entry.name.slice(0, 60);
    let meta: DemoMeta | undefined;
    if (fs.existsSync(sidecar)) {
      meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as DemoMeta;
      if (meta.name) name = meta.name;
    }

    for (const webm of webms) {
      const full = path.join(dir, webm);
      found.push({ webm: full, name, meta, modifiedAt: fs.statSync(full).mtimeMs });
    }
  }

  return found.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function toMp4(webm: string, target: string, config: ResolvedConfig): void {
  runFfmpeg([
    '-y',
    '-i', webm,
    '-vf', `fps=${config.video.fps},format=yuv420p`,
    '-c:v', 'libx264',
    '-crf', String(config.video.crf),
    '-preset', 'medium',
    '-movflags', '+faststart',
    target,
  ]);
}

/**
 * A gif for a README.
 *
 * Lower frame rate, capped width, and a palette generated from the recording itself: a 256-colour gif
 * made with the default palette bands badly on the flat colours a user interface is full of. A
 * full-width gif of a 1440-pixel viewport comes out around ten megabytes, which is not a thing to put
 * at the top of a page.
 */
function toGif(webm: string, target: string, config: ResolvedConfig): void {
  const { gifFps, gifWidth } = config.video;
  const scale = `scale='min(${String(gifWidth)},iw)':-2:flags=lanczos`;
  const filters = `fps=${String(gifFps)},${scale},split[a][b];[a]palettegen[p];[b][p]paletteuse`;
  runFfmpeg(['-y', '-i', webm, '-filter_complex', filters, '-loop', '0', target]);
}

const RENDERERS: Record<VideoFormat, (webm: string, target: string, c: ResolvedConfig) => void> = {
  mp4: toMp4,
  gif: toGif,
};

/**
 * The text that came out of the scenario, written beside the video.
 *
 * A recording made before this existed has no sidecar, and gets no captions rather than an empty
 * file claiming the demo said nothing.
 */
function writeCaptions(
  recording: Recording,
  base: string,
  config: ResolvedConfig,
): RenderedFile[] {
  const { meta } = recording;
  if (meta?.entries === undefined || meta.entries.length === 0) return [];

  const written: RenderedFile[] = [];
  const put = (extension: string, body: string): void => {
    const target = `${base}.${extension}`;
    fs.writeFileSync(target, body);
    written.push({ file: target, bytes: fs.statSync(target).size });
  };

  if (config.captions.vtt) put('vtt', toVtt(meta));
  if (config.captions.transcript) put('md', toTranscript(meta));
  return written;
}

/**
 * File names for a set of recordings, in the order given.
 *
 * Two scenarios that slug to the same name get an increasing suffix instead of overwriting each
 * other. Losing one take to another is not something anybody notices until they go looking for it.
 */
export function uniqueNames(recordings: readonly Recording[]): string[] {
  const used = new Set<string>();
  return recordings.map((recording) => {
    let name = recording.name;
    for (let n = 2; used.has(name); n += 1) name = `${recording.name}-${String(n)}`;
    used.add(name);
    return name;
  });
}

/**
 * Renders every recording found under `<output>/raw`.
 */
export function render(config: ResolvedConfig, rootDir = process.cwd()): RenderResult {
  const outputDir = path.resolve(rootDir, config.output);
  const recordings = findRecordings(path.join(outputDir, 'raw'));

  if (recordings.length === 0) return { recordings, files: [], missingFfmpeg: false };
  if (!hasFfmpeg()) return { recordings, files: [], missingFfmpeg: true };

  fs.mkdirSync(outputDir, { recursive: true });

  const files: RenderedFile[] = [];
  const names = uniqueNames(recordings);

  for (const [index, recording] of recordings.entries()) {
    const base = names[index] ?? recording.name;

    for (const format of config.video.formats) {
      const target = path.join(outputDir, `${base}.${format}`);
      RENDERERS[format](recording.webm, target, config);
      files.push({ file: target, bytes: fs.statSync(target).size });
    }

    files.push(...writeCaptions(recording, path.join(outputDir, base), config));
  }

  return { recordings, files, missingFfmpeg: false };
}
