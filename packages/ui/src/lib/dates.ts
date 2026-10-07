// Local calendar dates (YYYY-MM-DD). The work log and todos use the person's local day, not UTC.
const pad = (n: number) => String(n).padStart(2, "0");

export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday of the week containing `d`. */
export function weekStart(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoLocal(x);
}
