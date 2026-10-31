export { ACCOUNTS, SHIFTS, WORK_SHIFT_CODES } from "@shared/constants";

export const todayInput = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

/** Accepts "YYYY-MM-DD", an ISO date-time string or a Date. */
export const formatDate = (value: string | Date, options?: Intl.DateTimeFormatOptions) => {
  const date = typeof value === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value) : value;
  return new Intl.DateTimeFormat("en-GB", options ?? { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

export const formatTime = (value: string | Date | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value))
    : "—";

export const formatDateTime = (value: string | Date | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value))
    : "—";

export const minutesBetween = (start: string | Date, end: string | Date) =>
  Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000));

export const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${mins}m`;
};

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");

/**
 * Download rows as CSV. Cells that start with = + - @ are prefixed with ' so
 * Excel does not run them as formulas (CSV injection protection).
 */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (value: string | number | null | undefined) => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const BOM = String.fromCharCode(0xfeff); // lets Excel detect UTF-8
  const content = BOM + [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Minimal CSV parser that understands quoted cells and commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
