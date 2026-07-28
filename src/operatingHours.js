const OPERATING_HOURS = {
  0: null,
  1: { open: 10, close: 17 },
  2: { open: 10, close: 17 },
  3: { open: 10, close: 17 },
  4: { open: 10, close: 22 },
  5: { open: 10, close: 22 },
  6: { open: 10, close: 17 },
};

function getOperatingHoursForDate(dateLike) {
  if (!dateLike) return null;
  const date = new Date(`${dateLike}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return OPERATING_HOURS[date.getDay()] || null;
}

function getWeeklyOpeningHours() {
  return 'Mon - Wed: 10:00 AM - 5:00 PM • Thu - Fri: 10:00 AM - 10:00 PM • Sat: 10:00 AM - 5:00 PM • Sun: Closed';
}

function getOperatingHoursLabel(hours) {
  if (!hours) return 'Closed';
  const format = (value) => {
    const period = value >= 12 ? 'PM' : 'AM';
    const normalized = value % 12 === 0 ? 12 : value % 12;
    return `${normalized}:00 ${period}`;
  };
  return `${format(hours.open)} - ${format(hours.close)}`;
}

module.exports = {
  OPERATING_HOURS,
  getOperatingHoursForDate,
  getWeeklyOpeningHours,
  getOperatingHoursLabel,
};
