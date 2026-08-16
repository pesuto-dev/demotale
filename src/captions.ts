/**
 * Subtitles and a transcript, for free.
 *
 * The scenario already told us every line and the moment it went on screen, so a `.vtt` and a
 * readable `.md` cost nothing extra to produce. That matters more than it sounds: a video is opaque.
 * Nobody can search it, screen readers cannot read it, and nobody can quote from it. A recording that
 * ships with its own text is a recording somebody can actually use.
 *
 * Times are measured from the moment the fixture installs the overlay, which is a fraction of a
 * second after the video starts. For subtitles that stand for seconds at a time, that is close enough
 * to be right and cheap enough to be reliable.
 */

export type TimelineKind = 'say' | 'step' | 'card' | 'chapter' | 'wait' | 'note';

export interface TimelineEntry {
  /** Milliseconds since the recording began. */
  at: number;
  kind: TimelineKind;
  text: string;
  /** The step number, for a step. */
  badge?: string;
  /** The second line of a title card. */
  subtitle?: string;
  /** How long a named wait actually took. */
  durationMs?: number;
}

export interface DemoMeta {
  /** File name for the video, without extension. */
  name: string;
  /** The scenario title, as written in the test. */
  title: string;
  recordedAt: string;
  durationMs: number;
  entries: TimelineEntry[];
}

/** Cues are what a viewer reads along; a chapter marker and a corner note are not that. */
const CUE_KINDS: ReadonlySet<TimelineKind> = new Set<TimelineKind>(['say', 'step', 'card', 'wait']);

function stamp(ms: number, separator = '.'): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

/** Minutes and seconds, which is how a person refers to a place in a video. */
function shortStamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function cueText(entry: TimelineEntry): string {
  if (entry.kind === 'card') {
    return entry.subtitle ? `${entry.text} — ${entry.subtitle}` : entry.text;
  }
  return entry.text;
}

/** Each cue runs until the next one starts, so the text on screen and the text in the file agree. */
function withEndTimes(meta: DemoMeta): { entry: TimelineEntry; end: number }[] {
  const cues = meta.entries.filter((entry) => CUE_KINDS.has(entry.kind));
  return cues.map((entry, index) => ({
    entry,
    end: cues[index + 1]?.at ?? Math.max(meta.durationMs, entry.at + 2_000),
  }));
}

export function toVtt(meta: DemoMeta): string {
  const lines = ['WEBVTT', '', `NOTE ${meta.title}`, ''];
  const ends = new Map(withEndTimes(meta).map(({ entry, end }) => [entry, end]));

  let counter = 0;
  for (const entry of meta.entries) {
    if (entry.kind === 'chapter') {
      lines.push(`NOTE Chapter: ${entry.text}`, '');
      continue;
    }

    const end = ends.get(entry);
    if (end === undefined) continue;

    counter += 1;
    lines.push(String(counter), `${stamp(entry.at)} --> ${stamp(end)}`, cueText(entry), '');
  }

  return `${lines.join('\n')}\n`;
}

export function toTranscript(meta: DemoMeta): string {
  const seconds = Math.round(meta.durationMs / 1_000);
  const lines = [
    `# ${meta.title}`,
    '',
    `Recorded ${meta.recordedAt.slice(0, 10)} · ${shortStamp(meta.durationMs)} · ${String(seconds)} seconds`,
    '',
    '<!-- Written by demotale from the scenario. Re-recording the demo rewrites this file. -->',
    '',
  ];

  let openChapter = false;
  for (const entry of meta.entries) {
    const time = shortStamp(entry.at);

    switch (entry.kind) {
      case 'chapter':
        lines.push('', `## ${entry.text}`, '');
        openChapter = true;
        break;
      // Cards and notes are their own block, so the blank lines around them are not decoration:
      // without them Markdown folds the next list item into the paragraph above.
      case 'card':
        lines.push('', `**${time}** — ${entry.text}${entry.subtitle ? `: ${entry.subtitle}` : ''}`, '');
        break;
      case 'note':
        lines.push('', `> ${entry.text}`, '');
        break;
      case 'step':
        lines.push(`- **${time}** (${entry.badge ?? '·'}) ${entry.text}`);
        break;
      case 'say':
        lines.push(`- **${time}** ${entry.text}`);
        break;
      case 'wait':
        lines.push(
          `- **${time}** ${entry.text} _(waited ${String(Math.round((entry.durationMs ?? 0) / 1_000))}s)_`,
        );
        break;
    }
  }

  if (!openChapter) lines.push('');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
