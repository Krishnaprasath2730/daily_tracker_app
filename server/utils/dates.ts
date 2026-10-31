const pad = (value: number) => String(value).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (server time zone). */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
}

/** First day of the month after the given YYYY-MM month. */
export function nextMonthStart(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${pad(monthNumber + 1)}-01`;
}

/** Every date from start to end inclusive (YYYY-MM-DD). Capped to avoid runaway loops. */
export function eachDate(start: string, end: string, max = 366): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end && dates.length < max) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

/** Parse a punch time from a CSV. Accepts ISO strings and "YYYY-MM-DD HH:mm[:ss]" (treated as local time). */
export function parsePunchTime(value: string): Date | null {
  const trimmed = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  const date = local
    ? new Date(+local[1], +local[2] - 1, +local[3], +local[4], +local[5], +(local[6] ?? 0))
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
