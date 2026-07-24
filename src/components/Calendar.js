import React, { useState, useEffect } from 'react';
import './Calendar.css';

function Calendar({ blockedDates, onDateSelect, onTimeSelect, onEndTimeSelect, selectedDate, selectedTime, selectedEndTime, availabilityVersion }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availableTimes, setAvailableTimes] = useState([]);
  const [apiUnavailableDates, setApiUnavailableDates] = useState([]);
  const [apiSlotsByDate, setApiSlotsByDate] = useState({});
  const [apiFullDayBlockedDates, setApiFullDayBlockedDates] = useState([]);
  const [apiPartialBlockedSegments, setApiPartialBlockedSegments] = useState([]);
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState({ linked: false, authMode: 'none' });
  const [maxBookingDays, setMaxBookingDays] = useState(30);

  const OPERATING_HOURS = {
    0: null, // Sunday - closed
    1: { open: 10, close: 17 }, // Monday
    2: { open: 10, close: 17 }, // Tuesday
    3: { open: 10, close: 17 }, // Wednesday
    4: { open: 10, close: 22 }, // Thursday
    5: { open: 10, close: 22 }, // Friday
    6: { open: 10, close: 17 }, // Saturday
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const data = await response.json();
        setMaxBookingDays(data.max_booking_days || 30);
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const month = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
        const response = await fetch(`/api/availability?month=${month}`);
        if (!response.ok) return;

        const data = await response.json();
        setApiUnavailableDates(data.unavailableDates || []);
        setApiSlotsByDate(data.slotsByDate || {});
        setApiFullDayBlockedDates(data.fullDayBlockedDates || []);
        setApiPartialBlockedSegments(data.partialBlockedSegments || []);
        setGoogleCalendarStatus({
          linked: Boolean(data.source?.googleCalendarLinked),
          authMode: data.source?.authMode || 'none',
        });
      } catch (error) {
        console.error('Error fetching availability:', error);
      }
    };

    fetchAvailability();
  }, [currentMonth, availabilityVersion]);

  // Generate available time slots
  useEffect(() => {
    if (!selectedDate) {
      setAvailableTimes([]);
      return;
    }

    const apiSlots = apiSlotsByDate[selectedDate];
    if (Array.isArray(apiSlots)) {
      setAvailableTimes(apiSlots);
      return;
    }

    const date = new Date(selectedDate);
    const dayOfWeek = date.getDay();
    const hours = OPERATING_HOURS[dayOfWeek];

    if (!hours) {
      setAvailableTimes([]);
      return;
    }

    const times = [];
    for (let hour = hours.open; hour < hours.close; hour++) {
      times.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    setAvailableTimes(times);
  }, [selectedDate, apiSlotsByDate]);


  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const isDateBlocked = (day) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const blockedSet = new Set([...(blockedDates || []), ...(apiFullDayBlockedDates || []), ...(apiUnavailableDates || [])]);
    return blockedSet.has(dateStr) || isBeyondMaxDate(day);
  };

  const isBeyondMaxDate = (day) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const d = new Date(dateStr + 'T00:00:00');
    d.setHours(0,0,0,0);
    const max = new Date(); max.setHours(0,0,0,0); max.setDate(max.getDate() + maxBookingDays);
    return d > max;
  };

  const isDateClosed = (day) => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dayOfWeek = date.getDay();
    return OPERATING_HOURS[dayOfWeek] === null;
  };

  const isPastDate = (day) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    return date < today;
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const handleDateClick = (day) => {
    if (isDateBlocked(day) || isDateClosed(day) || isPastDate(day)) return;

    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDateSelect(dateStr);
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = [];

  // Empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="calendar-container">
      <div className="calendar-wrapper">
        <div className="calendar-header">
          <h3>Select Date & Time</h3>
          <p className="calendar-connected">
            {googleCalendarStatus.linked
              ? `Google Calendar availability is active (${googleCalendarStatus.authMode}).`
              : 'Google Calendar not linked. Set GOOGLE_CALENDAR_ICS_URL or GOOGLE_CALENDAR_ID + GOOGLE_API_KEY in your environment.'}
          </p>
          {apiUnavailableDates.length > 0 && (
            <p className="calendar-connected" style={{ marginTop: '4px', fontSize: '0.9rem' }}>
              Auto-blocked dates from Google booking availability: {apiUnavailableDates.slice(0, 5).join(', ')}{apiUnavailableDates.length > 5 ? '...' : ''}
            </p>
          )}
        </div>

        {/* Calendar */}
        <div className="calendar">
          <div className="calendar-nav">
            <button onClick={handlePrevMonth} className="nav-btn">←</button>
            <h4>{monthName}</h4>
            <button onClick={handleNextMonth} className="nav-btn">→</button>
          </div>

          <div className="calendar-weekdays">
            <div className="weekday">Sun</div>
            <div className="weekday">Mon</div>
            <div className="weekday">Tue</div>
            <div className="weekday">Wed</div>
            <div className="weekday">Thu</div>
            <div className="weekday">Fri</div>
            <div className="weekday">Sat</div>
          </div>

          <div className="calendar-days">
            {days.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="day empty"></div>;
              }

              const isBlocked = isDateBlocked(day);
              const isClosed = isDateClosed(day);
              const isPast = isPastDate(day);
              const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = selectedDate === dateStr;

              const isUnavailable = isBlocked || isClosed || isPast;
              let className = 'day';
              if (isUnavailable) className += ' unavailable';
              if (isPast) className += ' past';
              if (isSelected) className += ' selected';

              return (
                <button
                  key={day}
                  className={className}
                  onClick={() => handleDateClick(day)}
                  disabled={isUnavailable}
                  title={isUnavailable ? 'Unavailable' : 'Available'}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="calendar-legend">
            <div className="legend-item">
              <div className="legend-color available"></div>
              <span>Available</span>
            </div>
            <div className="legend-item">
              <div className="legend-color unavailable"></div>
              <span>Unavailable</span>
            </div>
          </div>
        </div>

        {/* Time Selection */}
        {selectedDate && (
          <div className="time-selection">
            <h4>Select Start Time</h4>
            <p className="selected-date">Date: {selectedDate}</p>
            {availableTimes.length > 0 ? (
              <div className="time-slots">
                {availableTimes.map((time) => (
                  <button
                    key={time}
                    className={`time-slot ${selectedTime === time ? 'selected' : ''}`}
                    onClick={() => onTimeSelect(time)}
                  >
                    {time}
                  </button>
                ))}
              </div>
            ) : (
              <p className="no-times">No available times for this date</p>
            )}

            {selectedTime && (
              <div className="end-time-selection">
                <h4>Select End Time (Minimum 2 hours)</h4>
                <div className="time-slots">
                  {availableTimes.map((time) => {
                    const [startHour, startMin] = selectedTime.split(':').map(Number);
                    const [endHour, endMin] = time.split(':').map(Number);
                    const startMinutes = startHour * 60 + startMin;
                    const endMinutes = endHour * 60 + endMin;
                    const durationHours = (endMinutes - startMinutes) / 60;

                    // Only show times that are at least 2 hours after start time
                    if (durationHours < 2) return null;

                    return (
                      <button
                        key={time}
                        className={`time-slot end-time-slot ${selectedEndTime === time ? 'selected' : ''}`}
                        onClick={() => onEndTimeSelect(time)}
                      >
                        {time} ({durationHours}h)
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Calendar;
