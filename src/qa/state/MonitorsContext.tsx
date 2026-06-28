import React from 'react';
import {
  MONITOR_SCHEDULER_INTERVAL_MS,
  MONITOR_STORAGE_KEY,
  nextMonitorDueAt,
  normalizeMonitor,
  runMonitorCollection,
} from '../Monitors';
import { loadJSON, saveJSON } from '../storage';
import { useWorkspace } from './WorkspaceContext';

// ── QA Touchstone — Monitors 狀態層 ─────────────────────────────────────────
// 從 AppShell 抽出的背景監控：monitor 清單、單次執行鎖（ref + state 雙軌，
// ref 防 race、state 供 UI）、排程器 tick、localStorage 持久化。
// 執行 context（env/vars/cookies/...）經 ref 快照取自 WorkspaceContext，
// 與抽出前 AppShell 的 monitorCtxRef 行為一致。

export interface MonitorRun {
  [key: string]: unknown;
}

export interface Monitor {
  id: string;
  name?: string;
  enabled?: boolean;
  cadence?: string;
  nextDueAt?: number | null;
  nextRun?: string;
  runs?: MonitorRun[];
  [key: string]: unknown;
}

export interface MonitorsState {
  monitors: Monitor[];
  setMonitors: React.Dispatch<React.SetStateAction<Monitor[]>>;
  monitorRunning: string | null;
  runMonitorById: (id: string, trigger?: string) => void;
  toggleMonitor: (id: string) => void;
  createMonitor: (mon: Partial<Monitor>) => void;
}

const MonitorsContext = React.createContext<MonitorsState | null>(null);

function loadInitialMonitors(): Monitor[] {
  const parsed = loadJSON<Monitor[]>(MONITOR_STORAGE_KEY, null);
  if (Array.isArray(parsed)) return parsed.map((m) => normalizeMonitor(m));
  return window.QA.MONITORS.map((m: Monitor) => normalizeMonitor(m));
}

export function MonitorsProvider({ children }: { children: React.ReactNode }) {
  const { env, vars, cookies, sslVerify, tests, oauthTokens } = useWorkspace();
  const [monitors, setMonitors] = React.useState<Monitor[]>(loadInitialMonitors);
  const [monitorRunning, setMonitorRunning] = React.useState<string | null>(null);
  const monitorsRef = React.useRef(monitors);
  const monitorCtxRef = React.useRef<Record<string, unknown>>({});
  const monitorRunningRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    monitorsRef.current = monitors;
  }, [monitors]);

  React.useEffect(() => {
    monitorCtxRef.current = { env, vars, cookies, sslVerify, tests, oauthTokens };
  }, [env, vars, cookies, sslVerify, tests, oauthTokens]);

  React.useEffect(() => {
    saveJSON(MONITOR_STORAGE_KEY, monitors);
  }, [monitors]);

  const runMonitorById = (id: string, trigger = 'manual') => {
    if (monitorRunningRef.current) return;
    const mon = monitorsRef.current.find((m) => m.id === id);
    if (!mon) return;
    monitorRunningRef.current = id;
    setMonitorRunning(id);
    (async () => {
      let run;
      try {
        run = await runMonitorCollection(mon, { ...monitorCtxRef.current, trigger });
      } catch {
        // Transport/run failure: release the lock but leave nextDueAt unchanged so
        // the next tick retries (the pre-existing behavior).
        if (monitorRunningRef.current === id) monitorRunningRef.current = null;
        setMonitorRunning(null);
        return;
      }
      const now = Date.now();
      setMonitors((ms) => {
        const next = ms.map((m) => {
          if (m.id !== id) return m;
          const nextDueAt = m.enabled ? nextMonitorDueAt(m.cadence, now) : null;
          return run
            ? { ...m, nextDueAt, nextRun: '', runs: [run, ...(m.runs || [])].slice(0, 20) }
            : { ...m, nextDueAt, nextRun: '' };
        });
        // Advance the scheduler's ref snapshot AND release the run lock atomically
        // with the committed nextDueAt. Clearing the lock in a separate `finally`
        // (as before) let a scheduler tick observe "not running" while monitorsRef
        // still held the pre-run (due) nextDueAt and re-fire the same monitor — a
        // race React 19's deferred effect flushing made observable.
        monitorsRef.current = next;
        if (monitorRunningRef.current === id) monitorRunningRef.current = null;
        return next;
      });
      setMonitorRunning(null);
    })();
  };

  const toggleMonitor = (id: string) =>
    setMonitors((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const enabled = !m.enabled;
        return {
          ...m,
          enabled,
          nextDueAt: enabled ? nextMonitorDueAt(m.cadence) : null,
          nextRun: enabled ? '' : 'paused',
        };
      })
    );

  const createMonitor = (mon: Partial<Monitor>) =>
    setMonitors((ms) => [normalizeMonitor(mon), ...ms]);

  React.useEffect(() => {
    const tick = () => {
      if (monitorRunningRef.current) return;
      const now = Date.now();
      const due = monitorsRef.current.find((m) => m.enabled && Number(m.nextDueAt) <= now);
      if (due) runMonitorById(due.id, 'schedule');
    };
    tick();
    const timer = setInterval(tick, MONITOR_SCHEDULER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const value: MonitorsState = {
    monitors,
    setMonitors,
    monitorRunning,
    runMonitorById,
    toggleMonitor,
    createMonitor,
  };
  return <MonitorsContext.Provider value={value}>{children}</MonitorsContext.Provider>;
}

export function useMonitors(): MonitorsState {
  const ctx = React.useContext(MonitorsContext);
  if (!ctx) throw new Error('useMonitors must be used inside <MonitorsProvider>');
  return ctx;
}
