import React, { useState, useEffect } from 'react';
import './Calendar.css';

function Calendar({ blockedDates, onDateSelect, onTimeSelect, onEndTimeSelect, selectedDate, selectedTime, selectedEndTime }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availableTimes, setAvailableTimes] = useState([]);

  const OPERATING_HOURS = {
    0: null, // Sunday - closed
    1: { open: 10, close: 17 }, // Monday
    2: { open: 10, close: 17 }, // Tuesday
    3: { open: 10, close: 17 }, // Wednesday
    4: { open: 10, close: 22 }, // Thursday
    5: { open: 10, close: 22 }, // Friday
    6: { open: 10, close: 17 }, // Saturday
  };

  // Generate available time slots
  useEffect(() => {
    if (!selectedDate) {
      setAvailableTimes([]);
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
  }, [selectedDate]);

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const isDateBlocked = (day) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return blockedDates.includes(dateStr);
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
