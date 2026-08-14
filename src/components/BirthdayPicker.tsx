import { useEffect, useRef, useState } from "react";
import {
  dayOptions,
  formatBirthday,
  monthOptions,
  parseBirthday,
  withBirthdayPart,
  yearOptions,
  type BirthdayParts,
} from "@/lib/birthday";

type BirthdayPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
};

export function BirthdayPicker({ value, onChange, disabled, id }: BirthdayPickerProps) {
  const [parts, setParts] = useState<BirthdayParts>(() => parseBirthday(value));
  const lastValue = useRef(value);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    setParts(parseBirthday(value));
  }, [value]);

  const days = dayOptions(parts.month, parts.year);
  const months = monthOptions();
  const years = yearOptions();

  const update = (key: keyof BirthdayParts, nextValue: string) => {
    const next = withBirthdayPart(parts, key, nextValue);
    setParts(next);
    if (!next.month && !next.day && !next.year) {
      lastValue.current = "";
      onChange("");
      return;
    }
    const formatted = formatBirthday(next);
    if (formatted) {
      lastValue.current = formatted;
      onChange(formatted);
    }
  };

  return (
    <div className="birthday-picker" role="group" aria-label="Birthday">
      <label className="birthday-part">
        <span className="visually-hidden">Month</span>
        <select
          id={id}
          value={parts.month}
          disabled={disabled}
          aria-label="Birth month"
          onChange={(event) => update("month", event.target.value)}
        >
          <option value="">Month</option>
          {months.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
      <label className="birthday-part">
        <span className="visually-hidden">Day</span>
        <select
          value={parts.day}
          disabled={disabled}
          aria-label="Birth day"
          onChange={(event) => update("day", event.target.value)}
        >
          <option value="">Day</option>
          {days.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </select>
      </label>
      <label className="birthday-part">
        <span className="visually-hidden">Year</span>
        <select
          value={parts.year}
          disabled={disabled}
          aria-label="Birth year"
          onChange={(event) => update("year", event.target.value)}
        >
          <option value="">Year</option>
          {years.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
