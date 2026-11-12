export function localInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
export const iso = (value: string) =>
  value ? new Date(value).toISOString() : null;
export function dayKey(value: string | Date, timeZone?: string) {
  const date = new Date(value);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join("-");
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function formatDate(
  value?: string | null,
  timeZone?: string,
  time = false,
) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}
export const statusLabel = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
};
export function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
