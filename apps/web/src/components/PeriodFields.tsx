import { parseDate, type DateValue } from '@internationalized/date';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  Popover,
  RangeCalendar,
} from 'react-aria-components';

function dateParts(value: string | null) {
  if (!value) return { day: '', time: '' };
  const shifted = new Date(Date.parse(value) + 9 * 3_600_000).toISOString();
  return { day: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}
export function PeriodFields({
  startAt,
  endAt,
  onChange,
  disabled = false,
}: {
  startAt: string | null;
  endAt: string | null;
  onChange: (start: string | null, end: string | null) => void;
  disabled?: boolean;
}) {
  const start = dateParts(startAt);
  const end = dateParts(endAt);
  const toUtc = (day: string, time: string) =>
    day && time ? new Date(`${day}T${time}:00+09:00`).toISOString() : null;
  const range =
    start.day && end.day ? { start: parseDate(start.day), end: parseDate(end.day) } : null;
  const setRange = (value: { start: DateValue; end: DateValue } | null) => {
    onChange(
      value ? toUtc(value.start.toString(), start.time || '10:00') : null,
      value ? toUtc(value.end.toString(), end.time || '16:00') : null,
    );
  };
  const times = Array.from(
    { length: 48 },
    (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
  );
  return (
    <fieldset className="period-fields">
      <legend>
        대여 기간 <span className="muted">서울 시간 · 30분 단위</span>
      </legend>
      <DateRangePicker
        value={range}
        onChange={setRange}
        className="date-range"
        shouldCloseOnSelect
        isDisabled={disabled}
      >
        <Label>날짜</Label>
        <Group className="date-group">
          <DateInput slot="start">{(segment) => <DateSegment segment={segment} />}</DateInput>
          <span aria-hidden="true">–</span>
          <DateInput slot="end">{(segment) => <DateSegment segment={segment} />}</DateInput>
          <Button aria-label="달력 열기">▦</Button>
        </Group>
        <Popover className="calendar-popover">
          <Dialog aria-label="대여 날짜 선택">
            <RangeCalendar>
              <header>
                <Button slot="previous" aria-label="이전 달">
                  ‹
                </Button>
                <Heading />
                <Button slot="next" aria-label="다음 달">
                  ›
                </Button>
              </header>
              <CalendarGrid>{(date) => <CalendarCell date={date} />}</CalendarGrid>
            </RangeCalendar>
          </Dialog>
        </Popover>
      </DateRangePicker>
      <div className="field-row">
        <label>
          시작 시각
          <select
            aria-label="시작 시각"
            disabled={disabled}
            value={start.time || '10:00'}
            onChange={(e) => onChange(toUtc(start.day, e.target.value), endAt)}
          >
            {times.map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
        </label>
        <label>
          종료 시각
          <select
            aria-label="종료 시각"
            disabled={disabled}
            value={end.time || '16:00'}
            onChange={(e) => onChange(startAt, toUtc(end.day, e.target.value))}
          >
            {times.map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-hint">1시간 이상, 최대 7일까지 빌릴 수 있어요.</p>
    </fieldset>
  );
}
