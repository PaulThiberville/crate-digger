import { Box, Static, Text, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../core/api.js';
import { NoBrowserError } from '../core/browser.js';
import type { DownloadStats } from '../core/download.js';
import type { ScanStats } from '../core/scan.js';
import type { Candidate, Mode, ScUser, Source } from '../core/types.js';
import { parseProfileUrl } from '../core/url.js';
import { isAbort } from '../core/util.js';
import { Banner } from '../ui/Banner.js';
import { color } from '../ui/theme.js';
import {
  DownloadView,
  LoginChoice,
  LoginManual,
  LoginWait,
  MODES,
  ModeChoice,
  RecapView,
  ScanView,
  Status,
  Summary,
  UrlPrompt,
  pickSelection,
  type Selection,
} from '../ui/views.js';
import type { Runtime } from './runtime.js';

type Phase =
  | { name: 'boot' }
  | { name: 'login-choice'; message: string }
  | { name: 'login-wait' }
  | { name: 'login-manual' }
  | { name: 'mode' }
  | { name: 'prompt'; mode: Mode; busy: boolean; error: string | null }
  | { name: 'scan'; source: Source; stats: ScanStats | null }
  | { name: 'recap'; source: Source; stats: ScanStats; candidates: Candidate[] }
  | { name: 'download'; stats: DownloadStats | null; label: string }
  | { name: 'done'; stats: DownloadStats | null; aborted: boolean }
  | { name: 'fatal'; error: string };

const LABELS: Record<Selection, string> = { all: 'HIGH + LOW + UNKNOWN', high: 'HIGH only', low: 'LOW only' };

export function App({ runtime, onExit }: { runtime: Runtime; onExit: (code: number) => void }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>({ name: 'boot' });
  const [status, setStatus] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const loginAbort = useRef<AbortController | null>(null);
  const loginMode = useRef<'auto' | 'manual'>('auto');
  const manualSkip = useRef<(() => void) | null>(null);
  const dlStats = useRef<DownloadStats | null>(null);

  const finish = (code: number) => {
    onExit(code);
    setTimeout(exit, 50); // let the last frame paint
  };
  const fatal = (err: unknown) => {
    if (isAbort(err) || runtime.signal.aborted) return finish(130);
    setPhase({ name: 'fatal', error: err instanceof Error ? err.message : String(err) });
    finish(1);
  };
  const chooseMode = () => setPhase({ name: 'mode' });
  const prompt = (mode: Mode, error: string | null = null) => setPhase({ name: 'prompt', mode, busy: false, error });

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      runtime.abort.abort();
      loginAbort.current?.abort();
      manualSkip.current?.();
      setStatus('stopping…');
      if (phase.name !== 'scan' && phase.name !== 'download') finish(130);
    }
  });

  // Boot: client_id, library, saved session.
  useEffect(() => {
    runtime.onStatus = setStatus;
    runtime
      .boot()
      .then((state) => {
        if (state === 'ready') {
          setSession(runtime.session?.permalink ?? null);
          setStatus(null);
          chooseMode();
        } else {
          setPhase({ name: 'login-choice', message: 'No valid SoundCloud session stored.' });
        }
      })
      .catch(fatal);
  }, []);

  const loggedIn = (me: ScUser | null, skipped: boolean) => {
    if (me) {
      setSession(me.permalink);
      setStatus(`connected as @${me.permalink}`);
    } else setStatus(skipped ? 'continuing without login' : 'login did not complete — continuing without login');
    chooseMode();
  };

  const startLogin = async () => {
    loginMode.current = 'auto';
    setPhase({ name: 'login-wait' });
    const ctrl = new AbortController();
    loginAbort.current = ctrl;
    try {
      const me = await runtime.login(ctrl.signal);
      if (loginMode.current === 'auto') loggedIn(me, ctrl.signal.aborted);
    } catch (err) {
      if (err instanceof NoBrowserError) return setPhase({ name: 'login-choice', message: err.message });
      fatal(err);
    }
  };

  const startManualLogin = async () => {
    loginMode.current = 'manual';
    loginAbort.current?.abort(); // stop the automatic cookie polling
    setPhase({ name: 'login-manual' });
    let skipped = false;
    try {
      const me = await runtime.loginManual(
        new Promise<void>((resolve) => {
          manualSkip.current = () => {
            skipped = true;
            resolve();
          };
        }),
      );
      loggedIn(me, skipped);
    } catch (err) {
      if (err instanceof NoBrowserError) return setPhase({ name: 'login-choice', message: err.message });
      fatal(err);
    }
  };

  const submitUrl = async (mode: Mode, raw: string) => {
    const permalink = parseProfileUrl(raw);
    if (!permalink) return prompt(mode, `Not a SoundCloud profile URL (expected soundcloud.com/name): ${raw.trim()}`);
    setPhase({ name: 'prompt', mode, busy: true, error: null });
    let profile: ScUser;
    try {
      profile = await runtime.resolveProfile(permalink);
    } catch (err) {
      if (isAbort(err) || runtime.signal.aborted) return finish(130);
      const msg = err instanceof ApiError && err.status === 404 ? `No SoundCloud profile at soundcloud.com/${permalink}` : `Could not resolve profile: ${(err as Error).message}`;
      return prompt(mode, msg);
    }
    const source: Source = { mode, profile };
    setStatus(null);
    setPhase({ name: 'scan', source, stats: null });
    try {
      const result = await runtime.scan(source, (stats) => setPhase({ name: 'scan', source, stats }));
      setPhase({ name: 'recap', source, stats: result.stats, candidates: result.candidates });
    } catch (err) {
      // Only the listing itself throws (per-account or per-track errors are counted): let the user retry or change mode.
      if (err instanceof ApiError && !runtime.signal.aborted) return prompt(mode, `Could not list the ${MODES[mode].unit} of @${profile.permalink}: ${err.message}`);
      fatal(err);
    }
  };

  const startDownload = async (source: Source, candidates: Candidate[], selection: Selection | 'quit') => {
    if (selection === 'quit') return finish(0);
    const items = pickSelection(candidates, selection);
    const label = `${LABELS[selection]} · ${items.length} tracks`;
    setPhase({ name: 'download', stats: null, label });
    try {
      const stats = await runtime.download(source, items, (live) => {
        dlStats.current = live;
        setPhase({ name: 'download', stats: live, label });
      });
      dlStats.current = stats;
      setPhase({ name: 'done', stats, aborted: false });
      finish(stats.fail > 0 ? 1 : 0);
    } catch (err) {
      if (isAbort(err) || runtime.signal.aborted) {
        setPhase({ name: 'done', stats: dlStats.current, aborted: true });
        return finish(130);
      }
      fatal(err);
    }
  };

  return (
    <Box flexDirection="column">
      <Static items={['banner']}>{(item) => <Banner key={item} />}</Static>
      <Status session={session} library={runtime.library?.dir ?? '…'} message={status} />
      {phase.name === 'boot' && <Text color={color.dim}>starting…</Text>}
      {phase.name === 'login-choice' && <LoginChoice message={phase.message} onChoose={(login) => (login ? void startLogin() : chooseMode())} />}
      {phase.name === 'login-wait' && <LoginWait onSkip={() => loginAbort.current?.abort()} onManual={() => void startManualLogin()} />}
      {phase.name === 'login-manual' && <LoginManual onSkip={() => manualSkip.current?.()} />}
      {phase.name === 'mode' && <ModeChoice onChoose={(mode) => prompt(mode)} />}
      {phase.name === 'prompt' && (
        <UrlPrompt mode={phase.mode} busy={phase.busy} error={phase.error} onSubmit={(raw) => void submitUrl(phase.mode, raw)} onBack={chooseMode} />
      )}
      {phase.name === 'scan' && (phase.stats ? <ScanView stats={phase.stats} /> : <Text color={color.dim}>preparing…</Text>)}
      {phase.name === 'recap' && (
        <RecapView stats={phase.stats} candidates={phase.candidates} loggedIn={session !== null} onChoose={(sel) => void startDownload(phase.source, phase.candidates, sel)} />
      )}
      {phase.name === 'download' && (phase.stats ? <DownloadView stats={phase.stats} label={phase.label} /> : <Text color={color.dim}>preparing…</Text>)}
      {phase.name === 'done' && (phase.stats ? <Summary stats={phase.stats} library={runtime.library.dir} aborted={phase.aborted} /> : <Text color={color.warn}>stopped.</Text>)}
      {phase.name === 'fatal' && <Text color={color.bad}>✖ {phase.error}</Text>}
    </Box>
  );
}
