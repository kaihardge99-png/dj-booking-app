const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

const getMonthDateRange = (year, monthIndex) => {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  return { firstDay, lastDay };
};

const parseUnavailableDatesFromLabels = (labels = [], month) => {
  if (!month) return [];

  const [yearStr, monthStr] = String(month).split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  if (!year || Number.isNaN(monthIndex)) return [];

  const normalizedMonth = MONTHS[monthIndex];
  const { firstDay, lastDay } = getMonthDateRange(year, monthIndex);
  const dates = new Set();

  const addDate = (day) => {
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    const date = `${yearStr}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dates.add(date);
  };

  const addWeekdayDates = (weekdayName, targetMonthName, targetYear, targetMonthIndex) => {
    const { firstDay, lastDay } = getMonthDateRange(targetYear, targetMonthIndex);
    const weekdayIndex = WEEKDAY_NAMES.indexOf(weekdayName.toLowerCase());
    if (weekdayIndex === -1) return;

    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === weekdayIndex) {
        addDate(d.getDate());
      }
    }
  };

  for (const label of labels) {
    const text = String(label || '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (!/no available times|no availability/i.test(lower)) continue;

    const monthMatch = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
    if (monthMatch && monthMatch[1].toLowerCase() !== normalizedMonth.toLowerCase()) {
      continue;
    }

    const weekdayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (weekdayMatch) {
      const weekdayName = weekdayMatch[1];
      addWeekdayDates(weekdayName, normalizedMonth, year, monthIndex);
      continue;
    }

    const dayMatch = text.match(/\b(\d{1,2})\b/);
    if (!dayMatch) continue;

    const day = Number(dayMatch[1]);
    addDate(day);
  }

  return Array.from(dates).sort();
};

module.exports = {
  parseUnavailableDatesFromLabels,
};
