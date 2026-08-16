/**
 * How the CLI talks.
 *
 * One sentence per thing that happened, no progress bars, no spinner. A recording already prints
 * Playwright's own output; anything this tool adds on top has to earn its line.
 */

export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** An error the user can act on, as opposed to a crash. The CLI prints it without a stack. */
export class UserFacingError extends Error {
  override readonly name = 'UserFacingError';

  constructor(
    message: string,
    /** What to try next, printed underneath. */
    readonly hint?: string,
  ) {
    super(message);
  }
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function relative(file: string, root = process.cwd()): string {
  return file.startsWith(root) ? file.slice(root.length).replace(/^[/\\]/, '') : file;
}
