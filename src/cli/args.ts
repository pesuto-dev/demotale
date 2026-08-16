/**
 * A small argument parser, deliberately not a dependency.
 *
 * It understands `--flag`, `--key value`, `--key=value` and `-h`, and treats everything else as a
 * positional. Anything after a bare `--` is handed through untouched, which is how `record` passes
 * extra arguments straight to Playwright.
 *
 * Callers must name their boolean flags. Without that, `demotale record --headed demo/tour.demo.ts`
 * reads the file name as the value of `--headed`, the scenario filter disappears, and every scenario
 * gets recorded instead of the one that was asked for. Silently.
 */

export interface Args {
  positional: string[];
  flags: Map<string, string | true>;
  /** Everything after a bare `--`. */
  rest: string[];
}

export function parseArgs(argv: string[], booleans: readonly string[] = []): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  const isBoolean = (name: string): boolean => booleans.includes(name) || name.startsWith('no-');

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;

    if (token === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const name = token.replace(/^--?/, '');
    const equals = name.indexOf('=');
    if (equals !== -1) {
      flags.set(name.slice(0, equals), name.slice(equals + 1));
      continue;
    }

    const next = argv[i + 1];
    if (!isBoolean(name) && next !== undefined && !next.startsWith('-')) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { positional, flags, rest };
}

export function flagString(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagBoolean(args: Args, name: string): boolean {
  return args.flags.has(name) && args.flags.get(name) !== 'false';
}

export function flagNumber(args: Args, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`demotale: --${name} expects a number, got "${value}".`);
  }
  return parsed;
}

/** `10m`, `90s` or a bare number of seconds, into milliseconds. */
export function parseDuration(value: string, name: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());
  if (match === null) {
    throw new Error(`demotale: --${name} expects something like 90s or 10m, got "${value}".`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit] ?? 1_000;
  return amount * factor;
}
