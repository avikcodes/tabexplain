"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AnalysisResults = {
  row_count: number;
  column_count: number;
  columns: string[];
  dtypes: Record<string, string>;
  missing_values: Record<string, number>;
  missing_percentages: Record<string, number>;
  outliers: Record<string, number>;
  correlations: Record<string, Record<string, number>>;
  distributions: Record<
    string,
    {
      min: number | null;
      max: number | null;
      mean: number | null;
      median: number | null;
      std: number | null;
    }
  >;
  top_values: Record<string, Record<string, number>>;
};

type HistoryItem = {
  id?: string;
  file_name?: string;
  created_at?: string;
};

type PersistedResult = {
  results: AnalysisResults;
  aiSummary: string;
  fileName: string;
};

type WsMessage =
  | { step?: string; progress?: number; results?: AnalysisResults; ai_summary?: string; session_id?: string; error?: string }
  | Record<string, never>;

const API_BASE = "http://localhost:8000";

function Icon({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
      {children}
    </div>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
    </svg>
  );
}

function RowsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4h4v16H6z" />
      <path d="M14 4h4v16h-4z" />
    </svg>
  );
}

function MissingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 4.3a2 2 0 0 1 3.4 0l7 12.1A2 2 0 0 1 19 19H5a2 2 0 0 1-1.7-2.6z" />
    </svg>
  );
}

function NumericIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
    </svg>
  );
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function correlationColor(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "rgba(255,255,255,0.04)";
  if (value === 0) return "rgba(148,163,184,0.18)";
  const intensity = Math.min(Math.abs(value), 1);
  if (value > 0) {
    return `rgba(16, 185, 129, ${0.12 + intensity * 0.72})`;
  }
  return `rgba(239, 68, 68, ${0.12 + intensity * 0.72})`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState("");
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [aiSummary, setAiSummary] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      try {
        const response = await fetch(`${API_BASE}/history`);
        if (!response.ok) return;
        const data = (await response.json()) as unknown;
        if (active) {
          setHistory(Array.isArray(data) ? (data as HistoryItem[]) : []);
        }
      } catch {
        if (active) setHistory([]);
      }
    }

    function loadPersistedResult() {
      try {
        const saved = localStorage.getItem("tabexplain_last_result");
        if (!saved) return;

        const parsed = JSON.parse(saved) as Partial<PersistedResult>;
        if (parsed.results) {
          setResults(parsed.results);
          setAiSummary(parsed.aiSummary ?? "");
          setProgress(100);
          setProgressStep("Complete");
        }
      } catch {
        // Ignore malformed persistence data.
      }
    }

    loadHistory();
    loadPersistedResult();

    return () => {
      active = false;
      socketRef.current?.close();
    };
  }, []);

  const missingChartData = useMemo(() => {
    if (!results) return [];
    return Object.entries(results.missing_percentages)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [results]);

  const correlationColumns = useMemo(() => {
    if (!results) return [];
    return Object.keys(results.correlations);
  }, [results]);

  const numericColumns = useMemo(() => {
    if (!results) return [];
    return Object.keys(results.distributions);
  }, [results]);

  async function handleAnalyse() {
    if (!file || loading) return;

    setLoading(true);
    setError("");
    setProgress(0);
    setProgressStep("Preparing file...");
    setResults(null);
    setAiSummary("");

    try {
      const fileReader = new FileReader();

      fileReader.onload = () => {
        const base64 = (fileReader.result as string).split(",")[1];
        console.log("File read complete");

        const ws = new WebSocket("ws://localhost:8000/ws/analyse");

        ws.onopen = () => {
          console.log("WebSocket opened, sending data");
          ws.send(
            JSON.stringify({
              filename: file.name,
              data: base64,
            })
          );
          console.log("Data sent");
        };

        ws.onmessage = (event) => {
          console.log("Message received:", event.data);
          const message = JSON.parse(event.data) as WsMessage;

          if (typeof message.progress === "number") {
            setProgress(message.progress);
          }
          if (message.step) {
            setProgressStep(message.step);
          }
          if (message.progress === 100) {
            if (message.results) {
              setResults(message.results);
            }
            if (typeof message.ai_summary === "string") {
              setAiSummary(message.ai_summary);
            }
            setLoading(false);
          }
        };

        ws.onerror = (event) => {
          console.log("WebSocket error:", event);
          setError("WebSocket connection failed");
          setLoading(false);
        };

        ws.onclose = () => {
          console.log("WebSocket closed");
        };
      };

      fileReader.readAsDataURL(file);
    } catch {
      setError("Failed to prepare the CSV file");
      setLoading(false);
    }
  }

  const handleFile = (selected: File | null) => {
    if (!selected) return;
    setFile(selected);
    setError("");
    setResults(null);
    setAiSummary("");
    setProgress(0);
    setProgressStep("");
    };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFile(event.dataTransfer.files?.[0] ?? null);
  };

  const missingPercent =
    results && results.row_count > 0
      ? (
          Object.values(results.missing_values).reduce((sum, value) => sum + value, 0) /
          (results.row_count * Math.max(results.column_count, 1))
        ) *
        100
      : 0;
  const numericCount = numericColumns.length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.06),_transparent_28%),radial-gradient(circle_at_bottom,_rgba(255,255,255,0.05),_transparent_20%)]" />

      <aside className="relative z-10 border-b border-white/8 bg-black/55 backdrop-blur md:fixed md:left-0 md:top-0 md:h-screen md:w-80 md:border-b-0 md:border-r md:border-white/10">
        <div className="flex h-full flex-col px-5 py-6">
          <div className="mb-6">
            <div className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium tracking-[0.24em] text-emerald-300 uppercase">
              History
            </div>
            <h2 className="mt-4 text-xl font-semibold text-white">Recent analyses</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Past runs fetched from Supabase. Click any item to inspect the record.
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                No past analyses yet
              </div>
            ) : (
              history.map((item, index) => {
                const rawDate = item.created_at ? new Date(item.created_at) : null;
                const dateLabel =
                  rawDate && !Number.isNaN(rawDate.getTime())
                    ? rawDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : "Unknown date";

                return (
                  <button
                    key={`${item.file_name ?? "history"}-${index}`}
                    type="button"
                    className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/8"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.file_name ?? "Untitled CSV"}</p>
                        <p className="mt-1 text-xs text-zinc-500">{dateLabel}</p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                        Saved
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </aside>

      <main className="relative z-10 md:pl-80">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-10">
          <header className="pt-4 md:pt-6">
            <div className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-1.5 text-[11px] font-medium tracking-[0.22em] text-emerald-300 uppercase">
              Open Source • Free Forever
            </div>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-6xl">
              TabExplain
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-300 sm:text-xl">
              Upload any CSV. Understand your data instantly.
            </p>
            <p className="mt-2 text-sm text-zinc-500">Built for researchers and ML engineers.</p>
          </header>

          <section className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[2rem] border border-white/10 bg-[#111111]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="flex flex-col gap-5">
                <div
                  onDragEnter={() => setDragActive(true)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`group flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed px-6 text-center transition ${
                    dragActive
                      ? "border-emerald-400 bg-emerald-400/10"
                      : "border-white/12 bg-black/30 hover:border-emerald-400/30 hover:bg-white/[0.04]"
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                  />
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-emerald-400/20 bg-emerald-400/10">
                    <FileIcon />
                  </div>
                  <p className="mt-5 text-lg font-medium text-white">
                    Drop your CSV here or click to browse
                  </p>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">
                    The analysis runs locally through a FastAPI WebSocket, then stores history in Supabase and caches results in Upstash.
                  </p>

                  {file ? (
                    <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/8 px-4 py-3 text-left">
                      <p className="text-sm font-medium text-white">{file.name}</p>
                      <p className="mt-1 text-xs text-emerald-200/80">{formatFileSize(file.size)}</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-zinc-400">
                    {file ? (
                      <span>
                        Ready to analyse <span className="text-white">{file.name}</span>
                      </span>
                    ) : (
                      <span>Select a CSV file to begin.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyse}
                    disabled={!file || loading}
                    className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
                  >
                    {loading ? "Analysing..." : "Analyse"}
                  </button>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-[#111111]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex h-full flex-col justify-between gap-5">
                <div>
                  <p className="text-sm font-medium tracking-[0.24em] text-emerald-300 uppercase">Quick Stats</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">At a glance</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    A compact overview appears here once the CSV has been processed.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatMini label="Rows" value={results ? results.row_count.toString() : "—"} />
                  <StatMini label="Columns" value={results ? results.column_count.toString() : "—"} />
                  <StatMini label="Missing %" value={results ? `${missingPercent.toFixed(2)}%` : "—"} />
                  <StatMini label="Numeric" value={results ? numericCount.toString() : "—"} />
                </div>

                <div className="rounded-3xl border border-emerald-400/15 bg-emerald-400/6 p-4">
                  <p className="text-sm text-zinc-300">
                    {results ? (
                      <>
                        <span className="text-emerald-300">Analysed columns:</span> {results.columns.join(", ")}
                      </>
                    ) : (
                      "Load a dataset to reveal column-level signals, missingness patterns, and correlation structure."
                    )}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {loading ? (
            <section className="mt-6 rounded-[2rem] border border-emerald-400/15 bg-[#111111]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] animate-pulse">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium tracking-[0.24em] text-emerald-300 uppercase">Progress</p>
                  <p className="mt-2 text-lg font-semibold text-white">{progressStep || "Working..."}</p>
                </div>
                <p className="text-sm text-zinc-400">{progress}%</p>
              </div>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(5, Math.min(progress, 100))}%` }}
                />
              </div>
            </section>
          ) : null}

          {results ? (
            <section className="mt-8 space-y-8 pb-10">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <OverviewCard icon={<RowsIcon />} label="Total Rows" value={results.row_count.toLocaleString()} />
                <OverviewCard icon={<ColumnsIcon />} label="Total Columns" value={results.column_count.toLocaleString()} />
                <OverviewCard icon={<MissingIcon />} label="Missing Values %" value={`${missingPercent.toFixed(2)}%`} />
                <OverviewCard icon={<NumericIcon />} label="Numeric Columns" value={numericCount.toLocaleString()} />
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <CardShell title="Missing Values by Column">
                  {missingChartData.length > 0 ? (
                    <div className="min-h-[300px]" style={{ width: "100%", height: 300 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={missingChartData}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: "#a1a1aa", fontSize: 12 }}
                            interval={0}
                            angle={-25}
                            textAnchor="end"
                            height={60}
                          />
                          <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                          <Tooltip
                            cursor={{ fill: "rgba(16,185,129,0.08)" }}
                            contentStyle={{
                              background: "#090909",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 16,
                              color: "#fff",
                            }}
                            formatter={(value) => [`${Number(value).toFixed(2)}%`, "Missing"]}
                          />
                          <Bar dataKey="value" fill="#10b981" radius={[10, 10, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState text="No missing values detected." />
                  )}
                </CardShell>

                <CardShell title="Correlation Matrix">
                  {correlationColumns.length > 0 ? (
                    <div className="overflow-auto">
                      <div
                        className="grid gap-1"
                        style={{
                          gridTemplateColumns: `180px repeat(${correlationColumns.length}, minmax(72px, 1fr))`,
                        }}
                      >
                        <div className="sticky left-0 z-10 bg-[#111111] p-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                          Column
                        </div>
                        {correlationColumns.map((column) => (
                          <div key={`head-${column}`} className="p-2 text-center text-xs font-medium text-zinc-300">
                            {column}
                          </div>
                        ))}

                        {correlationColumns.map((rowColumn) => (
                          <div key={`row-${rowColumn}`} className="contents">
                            <div className="sticky left-0 z-10 bg-[#111111] p-2 text-sm font-medium text-zinc-200">
                              {rowColumn}
                            </div>
                            {correlationColumns.map((colColumn) => {
                              const value = results.correlations[rowColumn]?.[colColumn];
                              return (
                                <div
                                  key={`${rowColumn}-${colColumn}`}
                                  className="flex min-h-16 items-center justify-center rounded-xl border border-white/5 text-sm font-semibold"
                                  style={{ backgroundColor: correlationColor(value) }}
                                >
                                  <span className="text-white">
                                    {typeof value === "number" ? value.toFixed(2) : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState text="Correlation data is unavailable for this dataset." />
                  )}
                </CardShell>
              </div>

              <CardShell title="Distributions">
                {numericColumns.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {numericColumns.map((column) => {
                      const stat = results.distributions[column];
                      return (
                        <div key={column} className="rounded-3xl border border-white/10 bg-black/30 p-4">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{column}</p>
                              <p className="mt-1 text-xs text-zinc-500">Numeric distribution summary</p>
                            </div>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                              Stats
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <StatChip label="Min" value={formatNumber(stat.min)} />
                            <StatChip label="Max" value={formatNumber(stat.max)} />
                            <StatChip label="Mean" value={formatNumber(stat.mean)} />
                            <StatChip label="Median" value={formatNumber(stat.median)} />
                            <div className="col-span-2">
                              <StatChip label="Std" value={formatNumber(stat.std)} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="No numeric columns were found." />
                )}
              </CardShell>

              <CardShell title="AI Summary">
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/25 px-4 py-10 text-center">
                  <p className="text-base font-medium text-zinc-200">AI Summary coming soon</p>
                </div>
              </CardShell>
            </section>
          ) : null}

          <footer className="mt-auto border-t border-white/8 py-6 text-sm text-zinc-500">
            Built by @avikcodes • Project 4 of 30
          </footer>
        </div>
      </main>
    </div>
  );
}

function CardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#111111]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function OverviewCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[#111111]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <Icon>{icon}</Icon>
        <span className="rounded-full border border-emerald-400/15 bg-emerald-400/8 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
          Live
        </span>
      </div>
      <p className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">{value}</p>
      <p className="mt-2 text-sm text-zinc-400">{label}</p>
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase">{label}</p>
      <p className="mt-3 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-black/25 px-4 py-10 text-center text-sm text-zinc-400">
      {text}
    </div>
  );
}
