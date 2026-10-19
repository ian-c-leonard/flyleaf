import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, formatGedcomDate } from '../app/lib/date-display.ts';

void test('family profile dates retain day, month or year precision', () => {
  assert.equal(formatGedcomDate('14 OCT 1926'), '14 October 1926');
  assert.equal(formatGedcomDate('SEP 1931'), 'September 1931');
  assert.equal(formatGedcomDate('1931'), '1931');
  assert.equal(formatGedcomDate('3 SEP 1897'), '3 September 1897');
  assert.equal(formatGedcomDate('FEB 1853'), 'February 1853');
  assert.equal(formatGedcomDate('29 FEB 1800'), '29 February 1800');
});

void test('qualifiers remain visible without turning approximate dates into exact dates', () => {
  const cases = [
    ['BEF 1987', 'Before 1987'],
    ['BEF JUL 1914', 'Before July 1914'],
    ['AFT 14 OCT 1926', 'After 14 October 1926'],
    ['ABT 1873', 'About 1873'],
    ['ABT 11 JAN 1846', 'About 11 January 1846'],
    ['EST SEP 1931', 'Estimated September 1931'],
    ['CAL JAN 1817', 'Calculated January 1817'],
  ];
  for (const [recorded, expected] of cases)
    assert.equal(formatGedcomDate(recorded), expected);
});

void test('inline event dates lower-case known qualifiers while preserving unsupported literal dates', () => {
  assert.equal(formatGedcomDate('BEF 1987', true), 'before 1987');
  assert.equal(formatGedcomDate('19 AUG 1958', true), '19 August 1958');
  assert.equal(
    formatGedcomDate('Before an uncertain year', true),
    'Before an uncertain year',
  );
});

void test('ranges and periods preserve both endpoints and their individual precision', () => {
  assert.equal(formatGedcomDate('BET 1834 AND 1835'), 'Between 1834 and 1835');
  assert.equal(
    formatGedcomDate('BET 21 APR 1878 AND 22 APR 1878'),
    'Between 21 April 1878 and 22 April 1878',
  );
  assert.equal(
    formatGedcomDate('FROM SEP 1931 TO 14 OCT 1932'),
    'From September 1931 to 14 October 1932',
  );
  assert.equal(formatGedcomDate('FROM 1931'), 'From 1931');
  assert.equal(formatGedcomDate('TO JUN 1933'), 'To June 1933');
});

void test('January to March dates keep both years of the old calendar', () => {
  assert.equal(formatGedcomDate('7 FEB 1661/62'), '7 February 1661/62');
  assert.equal(formatGedcomDate('MAR 1688/89'), 'March 1688/89');
  assert.equal(
    formatGedcomDate('ABT 16 MAR 1688/89'),
    'About 16 March 1688/89',
  );
  assert.equal(formatGedcomDate('7 JUN 1661/62'), '7 JUN 1661/62');
});

void test('unsupported, ambiguous and malformed forms return the exact original text', () => {
  for (const recorded of [
    '',
    'Unknown',
    '  Unknown  ',
    'c. 1931',
    'CIRCA 1931',
    '? 1931',
    '1931?',
    '1931/32',
    '14/10/1926',
    '@#DJULIAN@ 14 OCT 1726',
    'INT 1931 (from age at marriage)',
    '14 OCT',
    'OCTOBER 1926',
    '00 OCT 1926',
    '31 APR 1926',
    '30 FEB 1926',
    '14 XYZ 1926',
    '1931 BC',
    '0000',
    'ABT BEF 1931',
    'BET 1931 AND unknown',
    'FROM 1931 TO ABT 1932',
    'BET 1931 TO 1932',
    'BEF 1931 extra',
  ])
    assert.equal(formatGedcomDate(recorded), recorded);
});

void test('a dual-dated year counts by the modern reckoning', async () => {
  const { yearOf } = await import('../app/lib/gedcom.ts');
  assert.equal(yearOf('1 JAN 1652/53'), 1653);
  assert.equal(yearOf('2 MAR 1736/7'), 1737);
  assert.equal(yearOf('24 MAR 1799/00'), 1800);
  assert.equal(yearOf('ABT 1615'), 1615);
  assert.equal(yearOf('BET 1863 AND 1867'), 1863);
});

void test('calendar dates on the site read day, month, year', () => {
  assert.equal(calendarDate('2026-10-16'), '16 October 2026');
  assert.equal(calendarDate('1999-03-01'), '1 March 1999');
  assert.equal(calendarDate('not a date'), 'not a date');
});
