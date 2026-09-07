import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import os from 'node:os';
import { useEffect, useState } from 'react';
import type { DownloadStats } from '../core/download.js';
import type { ScanStats } from '../core/scan.js';
import type { Candidate, Quality } from '../core/types.js';
import { fmtBytes, fmtDuration, fmtInt } from '../core/util.js';
import { useTick } from './hooks.js';
import { color } from './theme.js';
import { Bar, Menu, Row, Spinner } from './widgets.js';

export function Status({ session, library, message }: { session: string | null; library: string; message: string | null }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {session ? (
          <>
            <Text color={color.ok}>●</Text> logged in as <Text bold>@{session}</Text>
          </>
        ) : (
          <>
            <Text color={color.warn}>○</Text> not logged in
          </>
        )}
        <Text color={color.dim}> · library {library.replace(os.homedir(), '~')}</Text>
      </Text>
      {message ? <Text color={color.dim}>{message}</Text> : null}
    </Box>
  );
}

export function LoginChoice({ message, onChoose }: { message: string; onChoose: (login: boolean) => void }) {
  return (
    <Box flexDirection="column">
      <Text color={color.warn}>{message}</Text>
      <Text color={color.dim}>Many official free downloads answer 401 without a SoundCloud session.</Text>
      <Box marginTop={1}>
        <Menu
          items={[
            { label: 'Log in with the browser', hint: 'Chrome/Edge/Brave opens soundcloud.com' },
            { label: 'Continue without login', hint: 'scan only, downloads get skipped' },
          ]}
          onSelect={(i) => onChoose(i === 0)}
        />
      </Box>
    </Box>
  );
}

export function LoginWait({ onSkip }: { onSkip: () => void }) {
  useInput((_, key) => {
    if (key.escape) onSkip();
  });
  return (
    <Box flexDirection="column">
      <Text>
        <Spinner /> Log in to SoundCloud in the browser window that just opened.
      </Text>
      <Text color={color.dim}>The window is your SoundCloud session for this run — keep it open. Esc to continue without login.</Text>
    </Box>
  );
}

export function UrlPrompt({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (raw: string) => void }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    if (error) setValue(''); // the rejected input is echoed in the error; start clean for the next paste
  }, [error]);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color.accent} bold>
          Curator URL:{' '}
        </Text>
        {busy ? (
          <Text>
            {value} <Spinner /> <Text color={color.dim}>resolving…</Text>
          </Text>
        ) : (
          <TextInput value={value} onChange={setValue} onSubmit={onSubmit} placeholder="https://soundcloud.com/some-curator" />
        )}
      </Box>
      {error ? (
        <Text color={color.bad}>✖ {error}</Text>
      ) : (
        <Text color={color.dim}>paste a SoundCloud profile URL, then Enter · Ctrl+C to quit</Text>
      )}
    </Box>
  );
}

export function ScanView({ stats }: { stats: ScanStats }) {
  useTick(100);
  const skipped = Object.values(stats.skipped).reduce((a, b) => a + b, 0);
  const ratio = stats.followingsTotal ? stats.followingsDone / stats.followingsTotal : 0;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color.accent} bold>
          SCAN
        </Text>{' '}
        <Text bold>{stats.curator.username}</Text> <Text color={color.dim}>@{stats.curator.permalink} · {fmtInt(stats.followingsTotal)} followings</Text>
      </Text>
      <Text>
        followings <Bar ratio={ratio} /> {stats.followingsDone}/{stats.followingsTotal}
      </Text>
      <Text>
        tracks inspected <Text bold>{fmtInt(stats.tracksSeen)}</Text>
      </Text>
      <Text>
        <Text color={color.ok}>eligible {stats.eligible}</Text> · <Text color={color.accent2}>high {stats.high}</Text> ·{' '}
        <Text color={color.warn}>low {stats.low}</Text> · unknown {stats.unknown} · <Text color={color.dim}>skipped {fmtInt(skipped)}</Text> ·{' '}
        <Text color={stats.errors ? color.bad : color.dim}>errors {stats.errors}</Text>
      </Text>
      <Text color={color.dim} wrap="truncate">
        <Spinner /> {stats.current}
      </Text>
    </Box>
  );
}

export type Selection = 'all' | 'high' | 'low';

export function pickSelection(candidates: Candidate[], selection: Selection): Candidate[] {
  const keep: Record<Selection, Quality[]> = { all: ['HIGH', 'LOW', 'UNKNOWN'], high: ['HIGH'], low: ['LOW', 'UNKNOWN'] };
  return candidates.filter((c) => keep[selection].includes(c.quality));
}

export function RecapView({
  stats,
  candidates,
  loggedIn,
  onChoose,
}: {
  stats: ScanStats;
  candidates: Candidate[];
  loggedIn: boolean;
  onChoose: (selection: Selection | 'quit') => void;
}) {
  const size = (list: Candidate[]) => {
    const known = list.reduce((n, c) => n + (c.size ?? 0), 0);
    const unknown = list.filter((c) => !c.size).length;
    if (unknown === list.length) return 'size n/a';
    return unknown ? `${fmtBytes(known)} (+${unknown} unknown)` : fmtBytes(known);
  };
  const hint = (list: Candidate[]) => (list.length ? `${list.length} tracks · ${size(list)}` : 'nothing to download');
  const all = candidates;
  const high = pickSelection(candidates, 'high');
  const low = pickSelection(candidates, 'low');
  const s = stats.skipped;
  const options: Selection[] = ['all', 'high', 'low'];
  return (
    <Box flexDirection="column">
      <Text color={color.accent} bold>
        RECAP <Text color={color.dim}>· scan took {fmtDuration((stats.finishedAt ?? Date.now()) - stats.startedAt)}</Text>
      </Text>
      <Row label="curator">
        <Text bold>{stats.curator.username}</Text> <Text color={color.dim}>@{stats.curator.permalink}</Text>
      </Row>
      <Row label="followings">{fmtInt(stats.followingsTotal)}</Row>
      <Row label="tracks">{fmtInt(stats.tracksSeen)} inspected</Row>
      <Row label="eligible">
        <Text color={color.ok} bold>
          {stats.eligible}
        </Text>{' '}
        · <Text color={color.accent2}>HIGH {stats.high}</Text> · <Text color={color.warn}>LOW {stats.low}</Text> · UNKNOWN {stats.unknown}
      </Row>
      <Row label="est. size">{stats.eligible ? size(all) : 'n/a'}</Row>
      <Row label="skipped" truncate>
        <Text color={color.dim}>
          too long {s.too_long} · no free DL {fmtInt(s.not_downloadable)} · quota {s.no_downloads_left} · private {s.not_public} · 403 {s.forbidden} · errors{' '}
          {stats.errors}
        </Text>
      </Row>
      {!loggedIn ? (
        <Text color={color.warn}>⚠ not logged in: formats are unknown and downloads will be skipped with “login required”.</Text>
      ) : stats.loginRequired ? (
        <Text color={color.warn}>⚠ {stats.loginRequired} tracks answered “login required” — the session may have expired.</Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text bold>What next?</Text>
        <Menu
          items={[
            { label: 'Download all (HIGH + LOW + UNKNOWN)', hint: hint(all), disabled: !all.length },
            { label: 'HIGH only (lossless)', hint: hint(high), disabled: !high.length },
            { label: 'LOW only (lossy + unknown)', hint: hint(low), disabled: !low.length },
            { label: 'Quit' },
          ]}
          onSelect={(i) => onChoose(options[i] ?? 'quit')}
        />
      </Box>
    </Box>
  );
}

export function DownloadView({ stats, label }: { stats: DownloadStats; label: string }) {
  useTick(100);
  const cur = stats.current;
  const fileRatio = cur?.size ? cur.bytes / cur.size : 0;
  const totalRatio = stats.total ? stats.done / stats.total : 0;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color.accent} bold>
          DOWNLOAD
        </Text>{' '}
        <Text color={color.dim}>{label}</Text>
      </Text>
      <Text wrap="truncate">
        ▸ {cur ? `${cur.uploader} — ${cur.title} · ${cur.ext} · ${cur.size ? fmtBytes(cur.size) : 'size n/a'}` : 'preparing…'}
      </Text>
      <Text>
        file  <Bar ratio={fileRatio} tone={color.accent2} /> {cur?.size ? `${Math.floor(fileRatio * 100)}%` : cur ? fmtBytes(cur.bytes) : ''}
      </Text>
      <Text>
        total <Bar ratio={totalRatio} /> {stats.done}/{stats.total} files
        <Text color={color.dim}>{stats.bytesTotal !== null ? ` · ${fmtBytes(stats.bytesDone)} / ${fmtBytes(stats.bytesTotal)}` : ` · ${fmtBytes(stats.bytesDone)}`}</Text>
      </Text>
      <Text>
        speed <Text bold>{fmtBytes(stats.speed)}/s</Text> · ETA <Text bold>{fmtDuration(stats.eta)}</Text>
      </Text>
      <Text>
        <Text color={color.ok}>ok {stats.ok}</Text> · <Text color={stats.fail ? color.bad : color.dim}>fail {stats.fail}</Text> ·{' '}
        <Text color={color.dim}>skip(already) {stats.already}</Text> · <Text color={stats.unauthorized ? color.warn : color.dim}>401 {stats.unauthorized}</Text>
      </Text>
    </Box>
  );
}

export function Summary({ stats, library, aborted }: { stats: DownloadStats; library: string; aborted: boolean }) {
  const elapsed = (stats.finishedAt ?? Date.now()) - stats.startedAt;
  return (
    <Box flexDirection="column">
      <Text color={aborted ? color.warn : stats.fail ? color.warn : color.ok} bold>
        {aborted ? 'STOPPED' : 'DONE'} <Text color={color.dim}>· {fmtDuration(elapsed)}</Text>
      </Text>
      <Text>
        <Text color={color.ok}>ok {stats.ok}</Text> · <Text color={stats.fail ? color.bad : color.dim}>fail {stats.fail}</Text> · already {stats.already} ·{' '}
        <Text color={stats.unauthorized ? color.warn : color.dim}>login required {stats.unauthorized}</Text> · {fmtBytes(stats.bytesDone)}
      </Text>
      <Text color={color.dim}>→ {library}</Text>
      {stats.failures.slice(0, 5).map((f) => (
        <Text key={f} color={color.bad} wrap="truncate">
          ✖ {f}
        </Text>
      ))}
      {stats.failures.length > 5 ? <Text color={color.dim}>… {stats.failures.length - 5} more</Text> : null}
    </Box>
  );
}
