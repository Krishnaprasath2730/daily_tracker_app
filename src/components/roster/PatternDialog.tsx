import { useState } from "react";
import { SHIFT_DEFS } from "@shared/roster";
import { Field } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EmployeeSummary } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRESETS: { label: string; pattern: string[] }[] = [
  { label: "Morning, Sat+Sun off", pattern: ["1", "1", "1", "1", "1", "WO", "WO"] },
  { label: "Day, Sun off", pattern: ["1A", "1A", "1A", "1A", "1A", "A", "WO"] },
  { label: "Evening, Sat+Sun off", pattern: ["2", "2", "2", "2", "2", "WO", "WO"] },
  { label: "Mid-day, Fri+Sat off", pattern: ["1B", "1B", "1B", "1B", "WO", "WO", "1B"] },
];

export type PatternInput = { employeeIds: number[]; from: string; to: string; pattern: string[]; overwrite: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: EmployeeSummary[];
  monthStart: string;
  monthEnd: string;
  pending: boolean;
  onSubmit: (input: PatternInput) => void;
};

export function PatternDialog({ open, onOpenChange, people, monthStart, monthEnd, pending, onSubmit }: Props) {
  const [pattern, setPattern] = useState<string[]>(PRESETS[0].pattern);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [overwrite, setOverwrite] = useState(false);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit({ employeeIds: [...selected], from, to, pattern, overwrite });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply weekly pattern</DialogTitle>
          <DialogDescription>Fill a date range with a repeating Monday–Sunday pattern. Approved leave (AL/EL) is never overwritten.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-5">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button type="button" key={preset.label} onClick={() => setPattern(preset.pattern)} className="rounded-full border border-[#d7dee8] px-3 py-1 text-xs text-[#475467] hover:border-[#0064e6] hover:text-[#0053bf]">{preset.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {WEEKDAYS.map((day, index) => (
                <label key={day} className="block text-center">
                  <span className="mb-1 block font-mono text-[10px] uppercase text-[#667085]">{day}</span>
                  <select
                    aria-label={`${day} shift`}
                    className="form-input h-10 px-1 text-center font-mono text-xs"
                    value={pattern[index]}
                    onChange={(e) => setPattern(pattern.map((code, i) => (i === index ? e.target.value : code)))}
                  >
                    <option value="">skip</option>
                    {SHIFT_DEFS.filter((def) => def.kind !== "leave").map((def) => <option key={def.code} value={def.code}>{def.code}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From"><input type="date" required className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" required className="form-input" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-[#344054]">Staff ({selected.size} selected)</span>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-[#0053bf] hover:underline" onClick={() => setSelected(new Set(people.map((p) => p.id)))}>Select all</button>
                <button type="button" className="text-[#667085] hover:underline" onClick={() => setSelected(new Set())}>None</button>
              </div>
            </div>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-[#e4e9f0] p-2 sm:grid-cols-2">
              {people.map((person) => (
                <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#f8fafc]">
                  <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                  <span className="truncate">{person.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-[#98a2b3]">{person.team}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-[#475467]">
            <input type="checkbox" className="mt-1" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Overwrite shifts that are already planned<span className="block text-xs text-[#98a2b3]">Off: only empty days are filled.</span></span>
          </label>

          <div className="flex justify-end gap-2 border-t border-[#edf0f4] pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !selected.size || !pattern.some(Boolean) || to < from}>{pending ? "Applying…" : "Apply pattern"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
