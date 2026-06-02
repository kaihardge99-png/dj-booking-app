import React, { useState, useEffect } from 'react';
import './BookingForm.css';
import Calendar from './Calendar';

const OPERATING_HOURS = {
  0: null, // Sunday - closed
  1: { open: 10, close: 17 }, // Monday
  2: { open: 10, close: 17 }, // Tuesday
  3: { open: 10, close: 17 }, // Wednesday
  4: { open: 10, close: 22 }, // Thursday
  5: { open: 10, close: 22 }, // Friday
  6: { open: 10, close: 17 }, // Saturday
};

const PRICING = {
  package1: 50,
  package2: 100,
  djm_v10_addon: 15,
};

function BookingForm({ blockedDates, isUserLoggedIn, onAuthRequired, username, userToken }) {
  const [formData, setFormData] = useState({
    user_name: '',
    user_email: '',
    user_phone: '',
    booking_date: '',
    start_time: '',
    end_time: '',
    package_type: 'package1',
    cdj_count: 2,
    mixer_type: 'DJM A9',
    djm_v10_addon: false,
    notes: '',
  });

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [totalPrice, setTotalPrice] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  useEffect(() => {
    calculatePrice();
  }, [formData.start_time, formData.end_time, formData.package_type, formData.djm_v10_addon]);

  // Prefill user name and email when logged in
  useEffect(() => {
    const prefillUserInfo = async () => {
      if (!isUserLoggedIn || !username || !userToken) return;
      try {
        const res = await fetch(`/api/user/info/${username}`, {
          headers: { 'Authorization': `Bearer ${userToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setFormData(prev => ({
          ...prev,
          user_name: data.username || prev.user_name,
          user_email: data.email || prev.user_email,
        }));
      } catch (err) {
        console.error('Error pre-filling user info:', err);
      }
    };

    prefillUserInfo();
  }, [isUserLoggedIn, username, userToken]);

  const calculatePrice = () => {
    if (!formData.start_time || !formData.end_time) {
      setTotalPrice(0);
      return;
    }

    const [startHour, startMin] = formData.start_time.split(':').map(Number);
    const [endHour, endMin] = formData.end_time.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (endMinutes <= startMinutes) {
      setTotalPrice(0);
      return;
    }

    const durationHours = (endMinutes - startMinutes) / 60;
    let price = PRICING[formData.package_type] * durationHours;

    if (formData.djm_v10_addon) {
      price += PRICING.djm_v10_addon * durationHours;
    }

    setTotalPrice(price);
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.user_name.trim()) newErrors.user_name = 'Name is required';
    if (!formData.user_email.trim()) newErrors.user_email = 'Email is required';
    if (!formData.user_phone.trim()) newErrors.user_phone = 'Phone is required';
    if (!formData.booking_date) newErrors.booking_date = 'Date is required';
    else {
      // enforce 30-day booking window client-side
      const bookingDate = new Date(formData.booking_date);
      bookingDate.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      const max = new Date(today); max.setDate(max.getDate() + 30);
      if (bookingDate < today) {
        newErrors.booking_date = 'Cannot book past dates';
      } else if (bookingDate > max) {
        newErrors.booking_date = 'Bookings can only be made up to 30 days in advance';
      }
    }
    if (!formData.start_time) newErrors.start_time = 'Start time is required';
    if (!formData.end_time) newErrors.end_time = 'End time is required';

    // Check if date is blocked
    if (blockedDates.includes(formData.booking_date)) {
      newErrors.booking_date = 'This date is not available';
    }

    // Check operating hours
    const bookingDate = new Date(formData.booking_date);
    const dayOfWeek = bookingDate.getDay();
    const hours = OPERATING_HOURS[dayOfWeek];

    if (!hours) {
      newErrors.booking_date = 'We are closed on Sundays';
    } else if (formData.start_time && formData.end_time) {
      const [startHour] = formData.start_time.split(':').map(Number);
      const [endHour] = formData.end_time.split(':').map(Number);

      if (startHour < hours.open || endHour > hours.close) {
        newErrors.start_time = `Operating hours: ${hours.open}:00 - ${hours.close}:00`;
      }
    }

    // Check time range and minimum 2 hours
    if (formData.start_time && formData.end_time) {
      const [startHour, startMin] = formData.start_time.split(':').map(Number);
      const [endHour, endMin] = formData.end_time.split(':').map(Number);

      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (endMinutes <= startMinutes) {
        newErrors.end_time = 'End time must be later than start time';
      } else {
        const durationHours = (endMinutes - startMinutes) / 60;
        if (durationHours < 2) {
          newErrors.end_time = 'Minimum booking is 2 hours';
        }
      }
    }

    // Check CDJ count
    if (formData.cdj_count < 2 || formData.cdj_count > 4) {
      newErrors.cdj_count = 'CDJ count must be between 2 and 4';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  const handleDateSelect = (date) => {
    setFormData({
      ...formData,
      booking_date: date,
      start_time: '',
      end_time: '',
    });
    setAvailabilityVersion((prev) => prev + 1);
  };

  const handleTimeSelect = (time) => {
    setFormData({
      ...formData,
      start_time: time,
      end_time: '',
    });
  };

  const handleEndTimeSelect = (time) => {
    setFormData({
      ...formData,
      end_time: time,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check if user is logged in
    if (!isUserLoggedIn) {
      onAuthRequired();
      return;
    }

    if (!validateForm()) return;

    const [startHour, startMin] = formData.start_time.split(':').map(Number);
    const [endHour, endMin] = formData.end_time.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const durationHours = (endMinutes - startMinutes) / 60;

    const bookingData = {
      ...formData,
      duration_hours: durationHours,
    };

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitted(true);
        setSubmitError('');
        setAvailabilityVersion((prev) => prev + 1);
        setFormData({
          user_name: '',
          user_email: '',
          user_phone: '',
          booking_date: '',
          start_time: '',
          end_time: '',
          package_type: 'package1',
          cdj_count: 2,
          mixer_type: 'DJM A9',
          djm_v10_addon: false,
          notes: '',
        });
        setTotalPrice(0);

        setTimeout(() => setSubmitted(false), 5000);
      } else {
        setSubmitError(data.error || 'Error submitting booking');
      }
    } catch (error) {
      console.error('Error:', error);
      setSubmitError('Error submitting booking');
    }
  };

  return (
    <div className="booking-form-container">
      {submitted && (
        <div className="success-message">
          ✓ Booking submitted successfully! Check your email for confirmation.
        </div>
      )}

      {/* Calendar Section */}
      <Calendar
        blockedDates={blockedDates}
        onDateSelect={handleDateSelect}
        onTimeSelect={handleTimeSelect}
        onEndTimeSelect={handleEndTimeSelect}
        selectedDate={formData.booking_date}
        selectedTime={formData.start_time}
        selectedEndTime={formData.end_time}
        availabilityVersion={availabilityVersion}
      />

      {/* Booking Form */}
      <div className="form-card">
        <h2>Complete Your Booking</h2>

        {submitError && <div className="form-error">{submitError}</div>}

        <form onSubmit={handleSubmit}>
          {/* Personal Information */}
          <fieldset>
            <legend>Your Information</legend>

            <div className="form-group">
              <label htmlFor="user_name">Full Name *</label>
              <input
                type="text"
                id="user_name"
                name="user_name"
                value={formData.user_name}
                onChange={handleChange}
                className={errors.user_name ? 'error' : ''}
              />
              {errors.user_name && <span className="error-text">{errors.user_name}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="user_email">Email *</label>
              <input
                type="email"
                id="user_email"
                name="user_email"
                value={formData.user_email}
                onChange={handleChange}
                className={errors.user_email ? 'error' : ''}
              />
              {errors.user_email && <span className="error-text">{errors.user_email}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="user_phone">Phone *</label>
              <input
                type="tel"
                id="user_phone"
                name="user_phone"
                value={formData.user_phone}
                onChange={handleChange}
                className={errors.user_phone ? 'error' : ''}
              />
              {errors.user_phone && <span className="error-text">{errors.user_phone}</span>}
            </div>
          </fieldset>

          {/* Session Details */}
          <fieldset>
            <legend>Session Details</legend>

            <div className="form-group">
              <label htmlFor="booking_date">Date *</label>
              <input
                type="date"
                id="booking_date"
                name="booking_date"
                value={formData.booking_date}
                onChange={handleChange}
                className={errors.booking_date ? 'error' : ''}
              />
              {errors.booking_date && <span className="error-text">{errors.booking_date}</span>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="start_time">Start Time *</label>
                <input
                  type="time"
                  id="start_time"
                  name="start_time"
                  value={formData.start_time}
                  onChange={handleChange}
                  className={errors.start_time ? 'error' : ''}
                />
                {errors.start_time && <span className="error-text">{errors.start_time}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="end_time">End Time *</label>
                <input
                  type="time"
                  id="end_time"
                  name="end_time"
                  value={formData.end_time}
                  onChange={handleChange}
                  className={errors.end_time ? 'error' : ''}
                />
                {errors.end_time && <span className="error-text">{errors.end_time}</span>}
              </div>
            </div>
          </fieldset>

          {/* Package Selection */}
          <fieldset>
            <legend>Package & Equipment</legend>

            <div className="form-group">
              <label htmlFor="package_type">Package *</label>
              <select
                id="package_type"
                name="package_type"
                value={formData.package_type}
                onChange={handleChange}
              >
                <option value="package1">Standard - $50/hr (CDJ3000 x2-4, Mixer, 2x QSC K12)</option>
                <option value="package2">Premium - $100/hr (All above + Recording, Video, Lighting)</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="cdj_count">CDJ3000 Count *</label>
                <select
                  id="cdj_count"
                  name="cdj_count"
                  value={formData.cdj_count}
                  onChange={handleChange}
                  className={errors.cdj_count ? 'error' : ''}
                >
                  <option value="2">2x CDJ3000</option>
                  <option value="3">3x CDJ3000</option>
                  <option value="4">4x CDJ3000</option>
                </select>
                {errors.cdj_count && <span className="error-text">{errors.cdj_count}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="mixer_type">Mixer *</label>
                <select
                  id="mixer_type"
                  name="mixer_type"
                  value={formData.mixer_type}
                  onChange={handleChange}
                >
                  <option value="DJM A9">DJM A9</option>
                  <option value="Xone 96">Xone 96</option>
                  <option value="Xone 92">Xone 92</option>
                </select>
              </div>
            </div>

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="djm_v10_addon"
                name="djm_v10_addon"
                checked={formData.djm_v10_addon}
                onChange={handleChange}
              />
              <label htmlFor="djm_v10_addon">Add DJM V10 Mixer (+$15/hr)</label>
            </div>
          </fieldset>

          {/* Notes */}
          <fieldset>
            <legend>Additional Information</legend>

            <div className="form-group">
              <label htmlFor="notes">Notes (Optional)</label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows="4"
                placeholder="Any special requests or notes..."
              />
            </div>
          </fieldset>

          {/* Price Summary */}
          <div className="price-summary">
            <h3>Price Summary</h3>
            <div className="price-row">
              <span>
                {formData.package_type === 'package1' ? 'Standard Package' : 'Premium Package'}
              </span>
              <span>${PRICING[formData.package_type]}/hr</span>
            </div>
            {formData.djm_v10_addon && (
              <div className="price-row">
                <span>DJM V10 Add-on</span>
                <span>${PRICING.djm_v10_addon}/hr</span>
              </div>
            )}
            <div className="price-row total">
              <span>Total</span>
              <span>${totalPrice.toFixed(2)}</span>
            </div>
          </div>

          <button type="submit" className="submit-btn">
            Book Session
          </button>
        </form>
      </div>
    </div>
  );
}

export default BookingForm;
