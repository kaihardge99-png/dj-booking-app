import React, { useState, useEffect } from 'react';
import './UserAccount.css';

function UserAccount({ username, userToken, onLogout }) {
  const [activeTab, setActiveTab] = useState('bookings');
  const [bookings, setBookings] = useState([]);
  const [userInfo, setUserInfo] = useState({
    username: username,
    email: '',
  });
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({
    username: username,
    email: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUserInfo();
  }, [username, userToken]);

  useEffect(() => {
    if (activeTab === 'bookings') {
      fetchUserBookings();
    }
  }, [activeTab, username, userToken]);

  const fetchUserInfo = async () => {
    if (!username || !userToken) return null;

    try {
      setLoading(true);
      const response = await fetch(`/api/user/info/${username}`, {
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      const data = await response.json();
      setUserInfo(data);
      setEditData(data);
      return data;
    } catch (err) {
      console.error('Error fetching user info:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchUserBookings = async () => {
    if (!username || !userToken) return;

    try {
      setLoading(true);
      let data = [];
      let userEmail = userInfo.email;

      const response = await fetch(`/api/bookings/user/${username}`, {
        headers: { 'Authorization': `Bearer ${userToken}` },
      });

      if (response.ok) {
        data = await response.json();
      } else {
        console.error('User bookings lookup failed:', response.statusText);
      }

      if (data.length === 0) {
        const info = await fetchUserInfo();
        userEmail = info?.email || userEmail;

        if (userEmail) {
          const emailResponse = await fetch(`/api/bookings/email/${encodeURIComponent(userEmail)}`);
          if (emailResponse.ok) {
            data = await emailResponse.json();
          }
        }
      }

      // Sort bookings: confirmed first, then pending, then cancelled; within each status sort by booking_date desc
      const statusOrder = { confirmed: 0, pending: 1, cancelled: 2 };
      const sorted = data.slice().sort((a, b) => {
        const sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 3;
        const sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 3;
        if (sa !== sb) return sa - sb;
        const da = new Date(a.booking_date || a.created_at || 0).getTime();
        const db = new Date(b.booking_date || b.created_at || 0).getTime();
        return db - da;
      });

      setBookings(sorted);
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData({ ...editData, [name]: value });
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch(`/api/user/update/${username}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify(editData),
      });

      const data = await response.json();

      if (response.ok) {
        setUserInfo(editData);
        setEditMode(false);
        setMessage('Profile updated successfully!');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setError(data.error || 'Failed to update profile');
      }
    } catch (err) {
      setError('Error updating profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="user-account-container">
      <div className="account-header">
        <h1>My Account</h1>
        <p className="username-display">Welcome, {username}!</p>
      </div>

      <div className="account-tabs">
        <button
          className={`tab-btn ${activeTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setActiveTab('bookings')}
        >
          My Bookings
        </button>
        <button
          className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile Settings
        </button>
      </div>

      <div className="account-content">
        {activeTab === 'bookings' && (
          <div className="bookings-section">
            <h2>My Bookings</h2>
            {loading ? (
              <p>Loading bookings...</p>
            ) : bookings.length === 0 ? (
              <p className="no-bookings">You haven't made any bookings yet.</p>
            ) : (
              <div className="bookings-list">
                {bookings.map((booking) => (
                  <div key={booking.id} className="booking-card">
                    <div className="booking-header">
                      <h3>{new Date(booking.booking_date).toLocaleDateString()}</h3>
                      <span className={`status-badge ${booking.status}`}>{booking.status}</span>
                    </div>
                    <div className="booking-details">
                      <p><strong>Time:</strong> {booking.start_time} - {booking.end_time}</p>
                      <p><strong>Duration:</strong> {booking.duration_hours} hours</p>
                      <p><strong>Package:</strong> {booking.package_type === 'package1' ? 'Standard' : 'Premium'}</p>
                      <p><strong>CDJ3000s:</strong> {booking.cdj_count}x</p>
                      <p><strong>Mixer:</strong> {booking.mixer_type}</p>
                      <p><strong>Total Price:</strong> ${booking.total_price}</p>
                      {booking.notes && <p><strong>Notes:</strong> {booking.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="profile-section">
            <h2>Profile Settings</h2>
            {message && <div className="success-message">{message}</div>}
            {error && <div className="error-message">{error}</div>}

            {!editMode ? (
              <div className="profile-view">
                <div className="profile-info">
                  <p><strong>Username:</strong> {userInfo.username}</p>
                  <p><strong>Email:</strong> {userInfo.email || 'Not set'}</p>
                </div>
                <button className="edit-btn" onClick={() => setEditMode(true)}>
                  Edit Profile
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} className="profile-form">
                <div className="form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    value={editData.username}
                    onChange={handleEditChange}
                    disabled
                  />
                  <small>Username cannot be changed</small>
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={editData.email}
                    onChange={handleEditChange}
                    placeholder="Enter your email"
                  />
                </div>

                <div className="form-actions">
                  <button type="submit" className="save-btn" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setEditMode(false);
                      setEditData(userInfo);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="account-footer">
        <button className="logout-btn" onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default UserAccount;
