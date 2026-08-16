/**
 * `demotale render` — the raw webm into files people can actually open.
 *
 * A missing ffmpeg is not a failure here. The webm is a real recording that plays in any browser, so
 * this says what is missing and how to install it, and stops with a zero exit code: a CI job that has
 * everything except ffmpeg should not go red over a file format.
 */
import { loadConfig } from '../config.js';
import { ffmpegInstallHint, render } from '../render.js';
import { emitJson, jsonReport, type Problem } from '../report.js';
import { megabytes, relative, say, warn } from './ui.js';

export interface RenderPayload {
  /** What came out, absolute paths, as the renderer wrote them. */
  files: { file: string; bytes: number }[];
  /** The raw recordings it found, whether or not it could turn them into anything. */
  recordings: { webm: string; name: string; modifiedAt: number }[];
  /** True when the webm files are all you have, because ffmpeg is not installed. */
  missingFfmpeg: boolean;
}

/** The work, without deciding how to say it. Shared with `record`, which renders at the end. */
export async function runRender(
  root: string,
): Promise<{ ok: boolean; problems: Problem[]; payload: RenderPayload }> {
  const { config } = await loadConfig(root);
  const result = render(config, root);

  const payload: RenderPayload = {
    files: result.files.map((file) => ({ file: file.file, bytes: file.bytes })),
    recordings: result.recordings.map((recording) => ({
      webm: recording.webm,
      name: recording.name,
      modifiedAt: recording.modifiedAt,
    })),
    missingFfmpeg: result.missingFfmpeg,
  };

  if (result.recordings.length === 0) {
    return {
      ok: false,
      problems: [
        { code: 'no-recording', message: 'No recording found to render.', fix: 'npx demotale record' },
      ],
      payload,
    };
  }

  if (result.missingFfmpeg) {
    // Not ok, but not a failure either: the recordings survive as webm and the exit code stays zero.
    return {
      ok: false,
      problems: [
        {
          code: 'missing-ffmpeg',
          message: 'ffmpeg is not available, so the recordings stay as webm.',
          fix: `npx demotale setup  # or: ${ffmpegInstallHint()}`,
        },
      ],
      payload,
    };
  }

  return { ok: true, problems: [], payload };
}

export async function renderCommand(root = process.cwd(), json = false): Promise<number> {
  const { ok, problems, payload } = await runRender(root);

  if (json) {
    emitJson(jsonReport('render', ok, problems, payload));
    return payload.recordings.length === 0 ? 1 : 0;
  }

  if (payload.recordings.length === 0) {
    warn('demotale: no recording found. Run "demotale record" first.');
    return 1;
  }

  if (payload.missingFfmpeg) {
    warn('demotale: ffmpeg is not available, so the recordings stay as webm:');
    for (const recording of payload.recordings) warn(`  ${relative(recording.webm, root)}`);
    warn(`Run "npx demotale setup", or install a system build with: ${ffmpegInstallHint()}`);
    return 0;
  }

  for (const file of payload.files) {
    say(`done: ${relative(file.file, root)} (${megabytes(file.bytes)})`);
  }
  return 0;
}
