/** Birthday stored as ISO `YYYY-MM-DD` when complete. Parsers tolerate common imports. */

export type BirthdayParts = {
  month: string;
  day: string;
  year: string;
};

export const EMPTY_BIRTHDAY: BirthdayParts = { month: "", day: "", year: "" };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthOptions() {
  return MONTHS.map((label, index) => ({
    value: String(index + 1).padStart(2, "0"),
    label,
  }));
}

export function yearOptions(from = 1920, to = new Date().getFullYear()) {
  const years: number[] = [];
  for (let year = to; year >= from; year -= 1) years.push(year);
  return years;
}

export function daysInMonth(month: number, year: number) {
  if (!month) return 31;
  const y = year || 2024; // leap-safe default when year unknown
  return new Date(y, month, 0).getDate();
}

export function dayOptions(month: string, year: string) {
  const count = daysInMonth(Number(month) || 0, Number(year) || 0);
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return { value: day, label: String(index + 1) };
  });
}

function clampDay(month: string, day: string, year: string) {
  if (!day) return "";
  const max = daysInMonth(Number(month) || 0, Number(year) || 0);
  const n = Number(day);
  if (!Number.isFinite(n) || n < 1) return "";
  return String(Math.min(n, max)).padStart(2, "0");
}

export function parseBirthday(value: string | null | undefined): BirthdayParts {
  const raw = String(value || "").trim();
  if (!raw) return { ...EMPTY_BIRTHDAY };

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return {
      year: iso[1],
      month: iso[2].padStart(2, "0"),
      day: iso[3].padStart(2, "0"),
    };
  }

  const us = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (us) {
    return {
      month: us[1].padStart(2, "0"),
      day: us[2].padStart(2, "0"),
      year: us[3],
    };
  }

  const named = raw.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i,
  );
  if (named) {
    const monthIndex = MONTHS.findIndex(
      (month) => month.toLowerCase() === named[1].toLowerCase(),
    );
    if (monthIndex >= 0) {
      return {
        month: String(monthIndex + 1).padStart(2, "0"),
        day: named[2].padStart(2, "0"),
        year: named[3] || "",
      };
    }
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    if (!Number.isNaN(date.getTime())) {
      return {
        year: String(date.getFullYear()),
        month: String(date.getMonth() + 1).padStart(2, "0"),
        day: String(date.getDate()).padStart(2, "0"),
      };
    }
  }

  return { ...EMPTY_BIRTHDAY };
}

export function formatBirthday(parts: BirthdayParts): string {
  const month = parts.month;
  const year = parts.year;
  const day = clampDay(month, parts.day, year);
  if (!month || !day || !year) return "";
  return `${year}-${month}-${day}`;
}

export function displayBirthday(value: string | null | undefined): string {
  const parts = parseBirthday(value);
  if (!parts.month || !parts.day) {
    const raw = String(value || "").trim();
    return raw;
  }
  const monthLabel = MONTHS[Number(parts.month) - 1] || parts.month;
  const dayLabel = String(Number(parts.day));
  return parts.year ? `${monthLabel} ${dayLabel}, ${parts.year}` : `${monthLabel} ${dayLabel}`;
}

export function withBirthdayPart(
  parts: BirthdayParts,
  key: keyof BirthdayParts,
  value: string,
): BirthdayParts {
  const next = { ...parts, [key]: value };
  next.day = clampDay(next.month, next.day, next.year);
  return next;
}
