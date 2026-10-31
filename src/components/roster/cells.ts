export type GridDay = { date: string; day: number; weekday: string; weekend: boolean };
export type Cell = { employeeId: number; dutyDate: string };

/** Map key for one roster cell: "employeeId|YYYY-MM-DD". */
export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`;
export const parseKey = (key: string): Cell => {
  const [id, date] = key.split("|");
  return { employeeId: Number(id), dutyDate: date };
};
