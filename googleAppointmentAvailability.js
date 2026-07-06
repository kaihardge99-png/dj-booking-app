const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const parseUnavailableDatesFromLabels = (labels = [], month) => {
  if (!month) return [];

  const [yearStr, monthStr] = String(month).split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  if (!year || Number.isNaN(monthIndex)) return [];

  const normalizedMonth = MONTHS[monthIndex];

  const dates = new Set();
  for (const label of labels) {
    const text = String(label || '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (!/no available times|no availability/i.test(lower)) continue;

    const monthMatch = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
    if (monthMatch && monthMatch[1].toLowerCase() !== normalizedMonth.toLowerCase()) {
      continue;
    }

    const dayMatch = text.match(/\b(\d{1,2})\b/);
    if (!dayMatch) continue;

    const day = Number(dayMatch[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const date = `${yearStr}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dates.add(date);
  }

  return Array.from(dates).sort();
};

module.exports = {
  parseUnavailableDatesFromLabels,
};
