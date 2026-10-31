import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, MousePointerClick, Undo2, X } from "lucide-react";
import { SHIFT_BY_CODE, SHIFT_DEFS, type DayCoverage, type EmployeeSummary, type RosterIssue } from "@shared/roster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EmployeeSummary as Person } from "@/lib/types";
import { cellKey, parseKey, type Cell, type GridDay } from "./cells";


type Point = { row: number; col: number };

type Props = {
  people: Person[];
  days: GridDay[];
  shifts: Map<string, string>;
  issues: Map<string, RosterIssue[]>;
  coverage: DayCoverage[];
  summaries: Map<number, EmployeeSummary>;
  editable: boolean;
  saving: boolean;
  today: string;
  currentUserId: number;
  canUndo: boolean;
  onApply: (cells: Cell[], code: string) => void;
  onUndo: () => void;
};

export function RosterGrid({ people, days, shifts, issues, coverage, summaries, editable, saving, today, currentUserId, canUndo, onApply, onUndo }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [typed, setTyped] = useState("");
  const dragging = useRef(false);
  const typeTimer = useRef<number | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);

  const keyAt = useCallback((p: Point) => cellKey(people[p.row].id, days[p.col].date), [people, days]);

  const rect = useCallback(
    (a: Point, b: Point) => {
      const keys = new Set<string>();
      for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r += 1)
        for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c += 1) keys.add(keyAt({ row: r, col: c }));
      return keys;
    },
    [keyAt],
  );

  // Stop dragging wherever the mouse is released.
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const clearSelection = () => {
    setSelected(new Set());
    setAnchor(null);
    setCursor(null);
  };

  const apply = useCallback(
    (code: string) => {
      if (!selected.size) return;
      onApply([...selected].map(parseKey), code);
    },
    [selected, onApply],
  );

  function onCellDown(event: React.MouseEvent, point: Point) {
    if (!editable) return;
    event.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    const key = keyAt(point);
    if (event.shiftKey && anchor) {
      const area = rect(anchor, point);
      setSelected(event.ctrlKey || event.metaKey ? new Set([...selected, ...area]) : area);
    } else if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setSelected(next);
      setAnchor(point);
    } else {
      setSelected(new Set([key]));
      setAnchor(point);
      dragging.current = true;
    }
    setCursor(point);
  }

  function onCellEnter(point: Point) {
    if (!dragging.current || !anchor) return;
    setSelected(rect(anchor, point));
    setCursor(point);
  }

  function selectRow(row: number) {
    if (!editable || !days.length) return;
    setAnchor({ row, col: 0 });
    setCursor({ row, col: days.length - 1 });
    setSelected(rect({ row, col: 0 }, { row, col: days.length - 1 }));
    gridRef.current?.focus({ preventScroll: true });
  }

  function selectColumn(col: number) {
    if (!editable || !people.length) return;
    setAnchor({ row: 0, col });
    setCursor({ row: people.length - 1, col });
    setSelected(rect({ row: 0, col }, { row: people.length - 1, col }));
    gridRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!editable) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (canUndo) onUndo();
      return;
    }
    if (event.key === "Escape") return clearSelection();
    if (!cursor) return;

    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dr, dc] = moves[event.key];
      const next = { row: Math.min(people.length - 1, Math.max(0, cursor.row + dr)), col: Math.min(days.length - 1, Math.max(0, cursor.col + dc)) };
      setCursor(next);
      if (event.shiftKey && anchor) setSelected(rect(anchor, next));
      else {
        setAnchor(next);
        setSelected(new Set([keyAt(next)]));
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      apply("-");
      return;
    }
    // Type a shift code (e.g. "1", "1A", "wo") to fill the selected cells.
    if (/^[0-9a-zA-Z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const buffer = (typed + event.key).toUpperCase();
      window.clearTimeout(typeTimer.current);
      const candidates = SHIFT_DEFS.filter((def) => def.code.startsWith(buffer));
      const exact = SHIFT_BY_CODE.has(buffer);
      if (exact && candidates.length === 1) {
        apply(buffer);
        setTyped("");
      } else if (candidates.length) {
        setTyped(buffer);
        typeTimer.current = window.setTimeout(() => {
          if (exact) apply(buffer);
          setTyped("");
        }, 700);
      } else setTyped("");
    }
  }

  const issueCount = (employeeId: number) =>
    days.reduce((sum, day) => sum + (issues.get(cellKey(employeeId, day.date))?.filter((i) => i.severity === "warning").length ?? 0), 0);

  const selectionSummary = useMemo(() => {
    if (!selected.size) return null;
    const rows = new Set([...selected].map((k) => k.split("|")[0])).size;
    return `${selected.size} cell${selected.size === 1 ? "" : "s"} · ${rows} staff`;
  }, [selected]);

  return (
    <div>
      {editable && (
        <div className="sticky top-[76px] z-30 flex min-h-14 flex-wrap items-center gap-2 border-b border-[#edf0f4] bg-white/95 px-4 py-2 backdrop-blur">
          {selectionSummary ? (
            <>
              <span className="mr-1 font-mono text-[11px] font-medium text-[#0053bf]">{selectionSummary}</span>
              <div className="flex flex-wrap gap-1">
                {SHIFT_DEFS.map((def) => (
                  <button
                    key={def.code}
                    type="button"
                    disabled={saving}
                    onClick={() => apply(def.code)}
                    title={`${def.label}${def.start ? ` · ${def.start}–${def.end}` : ""}`}
                    className="h-8 min-w-9 rounded-md border border-transparent px-2 font-mono text-[11px] font-semibold transition hover:border-[#0064e6] disabled:opacity-50"
                    style={{ background: def.bg, color: def.fg }}
                  >
                    {def.code}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => apply("-")}><Eraser className="h-3.5 w-3.5" />Clear</Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}><X className="h-3.5 w-3.5" />Deselect</Button>
              {typed && <span className="rounded bg-[#0e253f] px-2 py-1 font-mono text-[11px] text-white">{typed}…</span>}
            </>
          ) : (
            <span className="flex items-center gap-2 text-xs text-[#667085]"><MousePointerClick className="h-4 w-4 text-[#0064e6]" />Drag to select cells, Shift/Ctrl-click to extend, then pick a shift or type its code. Delete clears · Ctrl+Z undoes.</span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#98a2b3]">{saving ? "Saving…" : "All changes saved"}</span>
            <Button size="sm" variant="outline" disabled={!canUndo || saving} onClick={onUndo}><Undo2 className="h-3.5 w-3.5" />Undo</Button>
          </div>
        </div>
      )}

      <div
        ref={gridRef}
        tabIndex={editable ? 0 : -1}
        onKeyDown={onKeyDown}
        className="max-h-[70dvh] select-none overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0064e6]"
        role="grid"
        aria-label="Duty roster"
        aria-multiselectable={editable}
      >
        <table className="border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 min-w-56 border-b border-r border-[#e4e9f0] bg-[#f8fafc] px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-[#667085]">Employee</th>
              {days.map((day, col) => (
                <th
                  key={day.date}
                  onClick={() => selectColumn(col)}
                  className={cn(
                    "min-w-[46px] border-b border-r border-[#edf0f4] px-1 py-2 text-center font-mono",
                    day.weekend ? "bg-[#f2f4f7]" : "bg-[#f8fafc]",
                    day.date === today ? "text-[#0064e6]" : "text-[#667085]",
                    editable && "cursor-pointer hover:bg-[#edf5ff]",
                  )}
                  title={editable ? "Select this day for everyone" : undefined}
                >
                  <div className="text-[9px] font-medium uppercase">{day.weekday}</div>
                  <div className={cn("mt-1 text-xs font-medium", day.date === today && "mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#0064e6] text-white")}>{day.day}</div>
                </th>
              ))}
              {["Days", "Hours", "Off", "Leave"].map((label) => (
                <th key={label} className="min-w-14 border-b border-r border-[#edf0f4] bg-[#f8fafc] px-2 py-3 text-center font-mono text-[9px] font-medium uppercase tracking-wider text-[#667085]">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person, row) => {
              const summary = summaries.get(person.id);
              const warnings = issueCount(person.id);
              const mine = person.id === currentUserId;
              return (
                <tr key={person.id} className="group">
                  <td
                    onClick={() => selectRow(row)}
                    className={cn("sticky left-0 z-10 border-b border-r border-[#e4e9f0] px-4 py-2", mine ? "bg-[#f2f7ff]" : "bg-white group-hover:bg-[#fafbfd]", editable && "cursor-pointer")}
                    title={editable ? "Select this person's whole month" : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-[#1d2939]">{person.name}</span>
                      {warnings > 0 && <span className="rounded-full bg-[#fff0ee] px-1.5 font-mono text-[9px] font-semibold text-[#b42318]" title={`${warnings} roster warning${warnings === 1 ? "" : "s"}`}>{warnings}</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#98a2b3]">{person.employeeCode} · {person.team}</div>
                  </td>
                  {days.map((day, col) => {
                    const key = cellKey(person.id, day.date);
                    const code = shifts.get(key);
                    const def = code ? SHIFT_BY_CODE.get(code) : undefined;
                    const cellIssues = issues.get(key) ?? [];
                    const warning = cellIssues.some((i) => i.severity === "warning");
                    const isSelected = selected.has(key);
                    const title = [code ? `${code} · ${def?.label ?? ""}${def?.start ? ` ${def.start}–${def.end}` : ""}` : "Not planned", ...cellIssues.map((i) => `⚠ ${i.message}`)].join("\n");
                    return (
                      <td
                        key={day.date}
                        role="gridcell"
                        aria-selected={isSelected}
                        title={title}
                        onMouseDown={(event) => onCellDown(event, { row, col })}
                        onMouseEnter={() => onCellEnter({ row, col })}
                        className={cn(
                          "relative h-11 border-b border-r border-[#edf0f4] p-0 text-center",
                          !def && (day.weekend ? "bg-[#fafbfc]" : "bg-white"),
                          day.date === today && !isSelected && "shadow-[inset_0_0_0_1px_#9cc5f7]",
                          editable && "cursor-cell",
                        )}
                        style={def ? { background: def.bg } : undefined}
                      >
                        <span className="font-mono text-[11px] font-semibold" style={def ? { color: def.fg } : { color: "#d0d5dd" }}>{code ?? "·"}</span>
                        {cellIssues.length > 0 && (
                          <span className={cn("absolute right-0 top-0 h-0 w-0 border-l-[8px] border-t-[8px] border-l-transparent", warning ? "border-t-[#d92d20]" : "border-t-[#2e90fa]")} aria-hidden />
                        )}
                        {isSelected && <span className="pointer-events-none absolute inset-0 border-2 border-[#0064e6] bg-[#0064e6]/10" aria-hidden />}
                      </td>
                    );
                  })}
                  <td className="border-b border-r border-[#edf0f4] bg-white px-2 text-center font-mono text-[11px] font-medium text-[#344054]">{summary?.workDays ?? 0}</td>
                  <td className="border-b border-r border-[#edf0f4] bg-white px-2 text-center font-mono text-[11px] text-[#475467]">{summary ? Math.round(summary.hours * 10) / 10 : 0}</td>
                  <td className="border-b border-r border-[#edf0f4] bg-white px-2 text-center font-mono text-[11px] text-[#475467]">{summary?.off ?? 0}</td>
                  <td className="border-b border-r border-[#edf0f4] bg-white px-2 text-center font-mono text-[11px] text-[#946200]">{summary?.leave ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="sticky left-0 z-30 border-r border-t-2 border-[#e4e9f0] bg-[#f8fafc] px-4 py-2">
                <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#667085]">Staff working</div>
                <div className="mt-0.5 text-[9px] text-[#98a2b3]">count / minimum</div>
              </td>
              {coverage.map((day) => (
                <td
                  key={day.date}
                  title={`${day.working} working (minimum ${day.required})\n${Object.entries(day.byShift).map(([code, n]) => `${code}: ${n}`).join("\n") || "Nobody scheduled"}`}
                  className={cn("border-r border-t-2 border-[#e4e9f0] px-1 py-2 text-center font-mono", day.short ? "bg-[#fff0ee] text-[#b42318]" : "bg-[#f8fafc] text-[#157347]")}
                >
                  <div className="text-xs font-semibold">{day.working}</div>
                  <div className="text-[9px] opacity-70">/{day.required}</div>
                </td>
              ))}
              <td colSpan={4} className="border-t-2 border-[#e4e9f0] bg-[#f8fafc]" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
