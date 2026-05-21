import React, { useState, useEffect } from 'react';
import './AdminDashboard.css';

function AdminDashboard({ onBlockedDatesUpdate }) {
  const [activeTab, setActiveTab] = useState('bookings');
  const [bookings, setBookings] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [newBlockedDate, setNewBlockedDate] = useState('');
  const [newBlockedReason, setNewBlockedReason] = useState('');
  const [stats, setStats] = useState({
    total: 0,
    confirmed: 0,
    pending: 0,
    revenue: 0,
  });

  useEffect(() => {
    fetchBookings();
    fetchBlockedDates();
  }, []);

  const fetchBookings = async () => {
    try {
      const response = await fetch('/api/bookings');
      const data = await response.json();
      setBookings(data);
      calculateStats(data);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }
  };

  const fetchBlockedDates = async () => {
    try {
      const response = await fetch('/api/blocked-dates');
      const data = await response.json();
      setBlockedDates(data);
    } catch (error) {
      console.error('Error fetching blocked dates:', error);
    }
  };

  const calculateStats = (bookingsList) => {
    const stats = {
      total: bookingsList.length,
      confirmed: bookingsList.filter((b) => b.status === 'confirmed').length,
      pending: bookingsList.filter((b) => b.status === 'pending').length,
      revenue: bookingsList.reduce((sum, b) => sum + (b.total_price || 0), 0),
    };
    setStats(stats);
  };

  const handleStatusChange = async (bookingId, newStatus) => {
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        fetchBookings();
      }
    } catch (error) {
      console.error('Error updating booking:', error);
    }
  };

  const handleAddBlockedDate = async (e) => {
    e.preventDefault();

    if (!newBlockedDate) {
      alert('Please select a date');
      return;
    }

    try {
      const response = await fetch('/api/blocked-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newBlockedDate,
          reason: newBlockedReason,
        }),
      });

      if (response.ok) {
        setNewBlockedDate('');
        setNewBlockedReason('');
        fetchBlockedDates();
        onBlockedDatesUpdate();
      }
    } catch (error) {
      console.error('Error adding blocked date:', error);
    }
  };

  const handleDeleteBlockedDate = async (dateId) => {
    if (!window.confirm('Are you sure you want to remove this unavailable date?')) return;

    try {
      const response = await fetch(`/api/blocked-dates/${dateId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchBlockedDates();
        onBlockedDatesUpdate();
      }
    } catch (error) {
      console.error('Error deleting blocked date:', error);
    }
  };

  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-card">
        <h2>Admin Dashboard</h2>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Bookings</h3>
            <p className="stat-value">{stats.total}</p>
          </div>
          <div className="stat-card">
            <h3>Confirmed</h3>
            <p className="stat-value">{stats.confirmed}</p>
          </div>
          <div className="stat-card">
            <h3>Pending</h3>
            <p className="stat-value">{stats.pending}</p>
          </div>
          <div className="stat-card">
            <h3>Revenue</h3>
            <p className="stat-value">${stats.revenue.toFixed(2)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab-btn ${activeTab === 'bookings' ? 'active' : ''}`}
            onClick={() => setActiveTab('bookings')}
          >
            Bookings
          </button>
          <button
            className={`tab-btn ${activeTab === 'blocked' ? 'active' : ''}`}
            onClick={() => setActiveTab('blocked')}
          >
            Unavailable Dates
          </button>
        </div>

        {/* Bookings Tab */}
        {activeTab === 'bookings' && (
          <div className="tab-content">
            {bookings.length === 0 ? (
              <p className="no-data">No bookings yet</p>
            ) : (
              <div className="bookings-table-container">
                <table className="bookings-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Package</th>
                      <th>Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>{booking.user_name}</td>
                        <td>{booking.user_email}</td>
                        <td>{booking.booking_date}</td>
                        <td>
                          {booking.start_time} - {booking.end_time}
                        </td>
                        <td>{booking.package_type === 'package1' ? 'Standard' : 'Premium'}</td>
                        <td>${booking.total_price}</td>
                        <td>
                          <select
                            value={booking.status}
                            onChange={(e) => handleStatusChange(booking.id, e.target.value)}
                            className={`status-select ${booking.status}`}
                          >
                            <option value="pending">Pending</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Unavailable Dates Tab */}
        {activeTab === 'blocked' && (
          <div className="tab-content">
            <form onSubmit={handleAddBlockedDate} className="blocked-date-form unavailable-date-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="blocked_date">Date</label>
                  <input
                    type="date"
                    id="blocked_date"
                    value={newBlockedDate}
                    onChange={(e) => setNewBlockedDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="blocked_reason">Reason (Optional)</label>
                  <input
                    type="text"
                    id="blocked_reason"
                    value={newBlockedReason}
                    onChange={(e) => setNewBlockedReason(e.target.value)}
                    placeholder="e.g., Maintenance, Event"
                  />
                </div>
                <button type="submit" className="add-btn">
                  Add Unavailable Date
                </button>
              </div>
            </form>

            {blockedDates.length === 0 ? (
              <p className="no-data">No unavailable dates</p>
            ) : (
              <div className="blocked-dates-list unavailable-dates-list">
                {blockedDates.map((item) => (
                  <div key={item.id} className="blocked-date-item unavailable-date-item">
                    <div className="date-info">
                      <strong>{item.date}</strong>
                      {item.reason && <span className="reason">{item.reason}</span>}
                    </div>
                    <button
                      className="delete-btn"
                      onClick={() => handleDeleteBlockedDate(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
