const months: Record<string, string> = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  MAY: 'May',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
};

/** "2026-10-16" → "16 October 2026": day, month, year, as the book writes
 * dates, the same in every time zone and language setting. */
export function calendarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match && Object.values(months)[Number(match[2]) - 1];
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : iso;
}

function plainDate(value: string): string | null {
  const match = /^(?:(\d{1,2}) )?(?:([A-Z]{3}) )?(\d{3,4})(\/\d{2})?$/.exec(
    value,
  );
  if (!match || Number(match[3]) === 0) return null;
  const [, day, month, baseYear, dual] = match;
  // A dual year (1652/53) belongs only to January-March dates, when the old
  // and new calendars began the year on different days. It is shown as written.
  if (dual && !(month && ['JAN', 'FEB', 'MAR'].includes(month))) return null;
  const year = baseYear + (dual ?? '');
  if (!month) return day ? null : year;
  if (!months[month]) return null;
  if (!day) return `${months[month]} ${year}`;

  // Do not use Date: it would supply missing precision and assume a calendar.
  // February 29 is allowed without making a Gregorian leap-year assertion.
  const maxDay =
    month === 'FEB'
      ? 29
      : ['APR', 'JUN', 'SEP', 'NOV'].includes(month)
        ? 30
        : 31;
  if (Number(day) < 1 || Number(day) > maxDay) return null;
  return `${Number(day)} ${months[month]} ${year}`;
}

/** Display the recorded precision and qualifications; never infer a date.
 * Calendar escapes, interpreted dates and free text stay verbatim; a dual year
 * on a January-March date is shown as written (12 February 1652/53). */
export function formatGedcomDate(original: string, inline = false): string {
  const formatted = recordedDate(original);
  return inline && formatted !== original
    ? formatted.replace(
        /^(About|Before|After|Estimated|Calculated|Between|From|To)\b/,
        (word) => word.toLowerCase(),
      )
    : formatted;
}

function recordedDate(original: string): string {
  const value = original.trim();
  const plain = plainDate(value);
  if (plain !== null) return plain;

  const qualified = /^(ABT|BEF|AFT|EST|CAL) (.+)$/.exec(value);
  if (qualified) {
    const date = plainDate(qualified[2]);
    if (date === null) return original;
    const qualifier: Record<string, string> = {
      ABT: 'About',
      BEF: 'Before',
      AFT: 'After',
      EST: 'Estimated',
      CAL: 'Calculated',
    };
    return `${qualifier[qualified[1]]} ${date}`;
  }

  const range =
    /^(BET) (.+) AND (.+)$/.exec(value) || /^(FROM) (.+) TO (.+)$/.exec(value);
  if (range) {
    const start = plainDate(range[2]);
    const end = plainDate(range[3]);
    if (start === null || end === null) return original;
    return range[1] === 'BET'
      ? `Between ${start} and ${end}`
      : `From ${start} to ${end}`;
  }

  const openPeriod = /^(FROM|TO) (.+)$/.exec(value);
  if (openPeriod) {
    const date = plainDate(openPeriod[2]);
    if (date !== null)
      return `${openPeriod[1] === 'FROM' ? 'From' : 'To'} ${date}`;
  }
  return original;
}
