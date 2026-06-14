import React, { useState, useEffect } from 'react';
import './AdminDashboard.css';

function AdminDashboard({ onBlockedDatesUpdate }) {
  const [activeTab, setActiveTab] = useState('bookings');
  const [bookings, setBookings] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [calendarStatus, setCalendarStatus] = useState({ googleCalendarLinked: false, authMode: 'none' });
  const [calendarUnavailableDates, setCalendarUnavailableDates] = useState([]);
  const [newBlockedDate, setNewBlockedDate] = useState('');
  const [newBlockedStartTime, setNewBlockedStartTime] = useState('');
  const [newBlockedEndTime, setNewBlockedEndTime] = useState('');
  const [newBlockedReason, setNewBlockedReason] = useState('');
  const [editingBlockedDateId, setEditingBlockedDateId] = useState(null);
  const [editingBlockedDate, setEditingBlockedDate] = useState('');
  const [editingBlockedStartTime, setEditingBlockedStartTime] = useState('');
  const [editingBlockedEndTime, setEditingBlockedEndTime] = useState('');
  const [editingBlockedReason, setEditingBlockedReason] = useState('');
  const [importJsonText, setImportJsonText] = useState('');
  const [stats, setStats] = useState({
    total: 0,
    confirmed: 0,
    pending: 0,
    revenue: 0,
  });
  const [maxBookingDays, setMaxBookingDays] = useState(30);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  useEffect(() => {
    fetchBookings();
    fetchBlockedDates();
    fetchCalendarAvailability();
    fetchSettings();
  }, []);

  const fetchCalendarAvailability = async () => {
    try {
      const today = new Date();
      const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const response = await fetch(`/api/availability?month=${month}`);
      if (!response.ok) return;

      const data = await response.json();
      setCalendarStatus(data.source || { googleCalendarLinked: false, authMode: 'none' });
      setCalendarUnavailableDates(data.unavailableDates || []);
    } catch (error) {
      console.error('Error fetching calendar availability:', error);
    }
  };

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

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMessage('');

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_booking_days: maxBookingDays }),
      });

      if (response.ok) {
        setSettingsMessage('Settings saved successfully!');
        setTimeout(() => setSettingsMessage(''), 3000);
      } else {
        const data = await response.json();
        setSettingsMessage(data.error || 'Error saving settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSettingsMessage('Error saving settings');
    } finally {
      setSavingSettings(false);
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
          start_time: newBlockedStartTime || null,
          end_time: newBlockedEndTime || null,
        }),
      });

      if (response.ok) {
        setNewBlockedDate('');
        setNewBlockedStartTime('');
        setNewBlockedEndTime('');
        setNewBlockedReason('');
        fetchBlockedDates();
        fetchCalendarAvailability();
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

  const handleEditBlockedDate = (item) => {
    setEditingBlockedDateId(item.id);
    setEditingBlockedDate(item.date);
    setEditingBlockedStartTime(item.start_time || '');
    setEditingBlockedEndTime(item.end_time || '');
    setEditingBlockedReason(item.reason || '');
  };

  const handleCancelEdit = () => {
    setEditingBlockedDateId(null);
    setEditingBlockedDate('');
    setEditingBlockedStartTime('');
    setEditingBlockedEndTime('');
    setEditingBlockedReason('');
  };

  const handleSaveBlockedDate = async (e) => {
    e.preventDefault();

    if (!editingBlockedDate) {
      alert('Please select a date');
      return;
    }

    try {
      const response = await fetch(`/api/blocked-dates/${editingBlockedDateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editingBlockedDate,
          reason: editingBlockedReason,
          start_time: editingBlockedStartTime || null,
          end_time: editingBlockedEndTime || null,
        }),
      });

      if (response.ok) {
        handleCancelEdit();
        fetchBlockedDates();
        fetchCalendarAvailability();
        onBlockedDatesUpdate();
      }
    } catch (error) {
      console.error('Error updating blocked date:', error);
    }
  };

  const handleImportBulk = async () => {
    if (!importJsonText) {
      alert('Paste JSON array of blocked dates/segments into the box first');
      return;
    }

    try {
      const items = JSON.parse(importJsonText);
      const response = await fetch('/api/blocked-dates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });

      if (response.ok) {
        setImportJsonText('');
        fetchBlockedDates();
        fetchCalendarAvailability();
        onBlockedDatesUpdate();
        alert('Imported successfully');
      } else {
        const data = await response.json();
        alert(data.error || 'Import failed');
      }
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
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

        <div className="calendar-status-card">
          <div className="calendar-status-header">
            <h3>Calendar Availability</h3>
            <span className={`status-pill ${calendarStatus.googleCalendarLinked ? 'active' : 'inactive'}`}>
              {calendarStatus.googleCalendarLinked ? 'Linked' : 'Not linked'}
            </span>
          </div>
          <p>
            Source: <strong>{calendarStatus.authMode.replace('_', ' ')}</strong>
          </p>
          {calendarStatus.googleCalendarLinked ? (
            <div className="calendar-unavailable-list">
              <strong>Unavailable dates this month:</strong>
              {calendarUnavailableDates.length > 0 ? (
                <ul>
                  {calendarUnavailableDates.slice(0, 5).map((date) => (
                    <li key={date}>{date}</li>
                  ))}
                  {calendarUnavailableDates.length > 5 && <li>...and more</li>}
                </ul>
              ) : (
                <p>No unavailable dates were found.</p>
              )}
            </div>
          ) : (
            <p className="calendar-help-text">
              If your Google Calendar is linked, unavailable dates will appear here.
            </p>
          )}
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
          <button
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
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
                  <label htmlFor="blocked_start_time">Start Time (Optional)</label>
                  <input
                    type="time"
                    id="blocked_start_time"
                    value={newBlockedStartTime}
                    onChange={(e) => setNewBlockedStartTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="blocked_end_time">End Time (Optional)</label>
                  <input
                    type="time"
                    id="blocked_end_time"
                    value={newBlockedEndTime}
                    onChange={(e) => setNewBlockedEndTime(e.target.value)}
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

            <div className="bulk-import">
              <h4>Bulk import unavailable dates</h4>
              <p>Paste a JSON array of objects: {`[{"date":"2026-06-02","start_time":"15:00","end_time":"16:00"}, {"date":"2026-06-07"}]`}</p>
              <textarea
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder='Paste JSON array here'
                rows={6}
                style={{ width: '100%' }}
              />
              <button type="button" className="import-btn" onClick={handleImportBulk}>Import</button>
            </div>

            {blockedDates.length === 0 ? (
              <p className="no-data">No unavailable dates</p>
            ) : (
              <div className="blocked-dates-list unavailable-dates-list">
                {blockedDates.map((item) => (
                  <div key={item.id} className="blocked-date-item unavailable-date-item">
                    {editingBlockedDateId === item.id ? (
                      <form onSubmit={handleSaveBlockedDate} className="edit-blocked-date-form">
                        <div className="form-row">
                          <div className="form-group">
                            <label htmlFor="edit_blocked_date">Date</label>
                            <input
                              type="date"
                              id="edit_blocked_date"
                              value={editingBlockedDate}
                              onChange={(e) => setEditingBlockedDate(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="edit_blocked_start_time">Start Time (Optional)</label>
                            <input
                              type="time"
                              id="edit_blocked_start_time"
                              value={editingBlockedStartTime}
                              onChange={(e) => setEditingBlockedStartTime(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="edit_blocked_end_time">End Time (Optional)</label>
                            <input
                              type="time"
                              id="edit_blocked_end_time"
                              value={editingBlockedEndTime}
                              onChange={(e) => setEditingBlockedEndTime(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="edit_blocked_reason">Reason (Optional)</label>
                            <input
                              type="text"
                              id="edit_blocked_reason"
                              value={editingBlockedReason}
                              onChange={(e) => setEditingBlockedReason(e.target.value)}
                              placeholder="e.g., Maintenance, Event"
                            />
                          </div>
                          <div className="button-group">
                            <button type="submit" className="save-btn">
                              Save
                            </button>
                            <button type="button" className="cancel-btn" onClick={handleCancelEdit}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="date-info">
                          <strong>{item.date}</strong>
                          {item.start_time && item.end_time ? (
                            <span className="reason">{item.start_time} - {item.end_time}</span>
                          ) : (
                            <span className="reason">Full day</span>
                          )}
                          {item.reason && <span className="reason">{item.reason}</span>}
                        </div>
                        <div className="action-buttons">
                          <button
                            className="edit-btn"
                            onClick={() => handleEditBlockedDate(item)}
                          >
                            Edit
                          </button>
                          <button
                            className="delete-btn"
                            onClick={() => handleDeleteBlockedDate(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="tab-content">
            <h2>Booking Settings</h2>
            <form onSubmit={handleSaveSettings} className="settings-form">
              <div className="form-group">
                <label htmlFor="max_booking_days">Maximum Booking Days in Advance</label>
                <input
                  type="number"
                  id="max_booking_days"
                  min="1"
                  max="365"
                  value={maxBookingDays}
                  onChange={(e) => setMaxBookingDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))}
                />
                <small>Customers can only book this many days in advance (1-365 days)</small>
              </div>
              <button type="submit" className="save-btn" disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
              {settingsMessage && (
                <div className={`message ${settingsMessage.includes('successfully') ? 'success' : 'error'}`}>
                  {settingsMessage}
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
