import React, { useState, useEffect } from 'react';
import './App.css';
import Header from './components/Header';
import Auth from './components/Auth';
import BookingForm from './components/BookingForm';
import BookingsList from './components/BookingsList';
import UserAccount from './components/UserAccount';
import AdminDashboard from './components/AdminDashboard';
import AdminLogin from './components/AdminLogin';
import ResetPassword from './components/ResetPassword';

function App() {
  const [currentPage, setCurrentPage] = useState('booking');
  const [userToken, setUserToken] = useState(localStorage.getItem('userToken'));
  const [username, setUsername] = useState(localStorage.getItem('username'));
  const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken'));
  const [blockedDates, setBlockedDates] = useState([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [resetToken, setResetToken] = useState(null);

  // Check if accessing admin page or reset password via URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'true') {
      setCurrentPage('admin');
    }
    if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') {
      setCurrentPage('admin');
    }
    if (params.get('reset')) {
      setResetToken(params.get('reset'));
    }
  }, []);

  useEffect(() => {
    if (currentPage === 'booking') {
      fetchBlockedDates();
    }
  }, [currentPage]);

  const fetchBlockedDates = async () => {
    try {
      const response = await fetch('/api/blocked-dates');
      const data = await response.json();
      setBlockedDates(
        data
          .filter((d) => !d.start_time && !d.end_time)
          .map((d) => d.date),
      );
    } catch (error) {
      console.error('Error fetching blocked dates:', error);
    }
  };

  const handleLoginSuccess = (token, user) => {
    setUserToken(token);
    setUsername(user);
    setShowAuthModal(false);
  };

  const handleSignupSuccess = (token, user) => {
    setUserToken(token);
    setUsername(user);
    setShowAuthModal(false);
  };

  const handleUserLogout = () => {
    setUserToken(null);
    setUsername(null);
    localStorage.removeItem('userToken');
    localStorage.removeItem('username');
    setCurrentPage('booking');
  };

  const handleAdminLogin = (token) => {
    setAdminToken(token);
    localStorage.setItem('adminToken', token);
    setCurrentPage('admin');
  };

  const handleLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('adminToken');
    setCurrentPage('booking');
  };

  const handleBlockedDatesUpdate = () => {
    fetchBlockedDates();
  };

  const handleAuthRequired = () => {
    setShowAuthModal(true);
  };

  const handleResetSuccess = () => {
    setResetToken(null);
    setShowAuthModal(true);
    // Clear the reset token from URL
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  return (
    <div className="App">
      <Header
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        isAdmin={!!adminToken}
        isUser={!!userToken}
        username={username}
        onLogout={handleLogout}
        onUserLogout={handleUserLogout}
        onAuthRequired={handleAuthRequired}
      />

      <main className="main-content">
        {resetToken ? (
          <ResetPassword resetToken={resetToken} onResetSuccess={handleResetSuccess} />
        ) : currentPage === 'booking' ? (
          <>
            <BookingForm 
              blockedDates={blockedDates} 
              isUserLoggedIn={!!userToken}
              onAuthRequired={handleAuthRequired}
              username={username}
              userToken={userToken}
            />
            {showAuthModal && (
              <div className="auth-modal-overlay">
                <div className="auth-modal">
                  <button className="close-modal" onClick={() => setShowAuthModal(false)}>×</button>
                  <Auth onLoginSuccess={handleLoginSuccess} onSignupSuccess={handleSignupSuccess} />
                </div>
              </div>
            )}
          </>
        ) : currentPage === 'account' && userToken ? (
          <UserAccount username={username} userToken={userToken} onLogout={handleUserLogout} />
        ) : currentPage === 'view' ? (
          <BookingsList />
        ) : currentPage === 'admin' && adminToken ? (
          <AdminDashboard onBlockedDatesUpdate={handleBlockedDatesUpdate} adminToken={adminToken} />
        ) : currentPage === 'admin' ? (
          <AdminLogin onLogin={handleAdminLogin} />
        ) : null}
      </main>
    </div>
  );
}

export default App;
