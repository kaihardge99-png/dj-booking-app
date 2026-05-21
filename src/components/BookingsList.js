import React, { useState } from 'react';
import './BookingsList.css';

function BookingsList() {
  const [email, setEmail] = useState('');
  const [bookings, setBookings] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/bookings/email/${email}`);
      const data = await response.json();
      setBookings(data);
      setSearched(true);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bookings-list-container">
      <div className="search-card">
        <h2>View Your Bookings</h2>

        <form onSubmit={handleSearch}>
          <div className="search-group">
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="search-btn">
              Search
            </button>
          </div>
        </form>

        {loading && <p className="loading">Loading...</p>}

        {searched && bookings.length === 0 && !loading && (
          <p className="no-results">No bookings found for this email.</p>
        )}

        {bookings.length > 0 && (
          <div className="bookings-grid">
            {bookings.map((booking) => (
              <div key={booking.id} className="booking-card">
                <div className="booking-header">
                  <h3>{booking.user_name}</h3>
                  <span className={`status-badge ${booking.status}`}>
                    {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                  </span>
                </div>

                <div className="booking-details">
                  <div className="detail-row">
                    <span className="label">Date:</span>
                    <span className="value">{booking.booking_date}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Time:</span>
                    <span className="value">
                      {booking.start_time} - {booking.end_time}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Duration:</span>
                    <span className="value">{booking.duration_hours} hours</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Package:</span>
                    <span className="value">
                      {booking.package_type === 'package1' ? 'Standard' : 'Premium'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Price:</span>
                    <span className="value">${booking.total_price}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Email:</span>
                    <span className="value">{booking.user_email}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Phone:</span>
                    <span className="value">{booking.user_phone}</span>
                  </div>
                  {booking.notes && (
                    <div className="detail-row">
                      <span className="label">Notes:</span>
                      <span className="value">{booking.notes}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingsList;
