import React from 'react';
import './Header.css';

function Header({ currentPage, setCurrentPage, isAdmin, isUser, username, onLogout, onUserLogout, onAuthRequired }) {
  return (
    <header className="header">
      <div className="header-container">
        <div className="logo-section">
          <img src="/logo.webp" alt="AllFriends AV Logo" className="logo-image" />
          <div className="logo-text">
            <h1 className="logo">AllFriends AV</h1>
            <p className="tagline">DJ Practice Sessions</p>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-btn ${currentPage === 'booking' ? 'active' : ''}`}
            onClick={() => {
              setCurrentPage('booking');
              if (!isUser) onAuthRequired();
            }}
          >
            {isUser ? 'Book Session' : 'Sign In'}
          </button>
          {!isUser && (
            <button
              className={`nav-btn ${currentPage === 'view' ? 'active' : ''}`}
              onClick={() => setCurrentPage('view')}
            >
              View Bookings
            </button>
          )}
          {isUser && (
            <button
              className={`nav-btn ${currentPage === 'account' ? 'active' : ''}`}
              onClick={() => setCurrentPage('account')}
            >
              My Account
            </button>
          )}
          {isAdmin && (
            <>
              <button
                className={`nav-btn ${currentPage === 'admin' ? 'active' : ''}`}
                onClick={() => setCurrentPage('admin')}
              >
                Admin
              </button>
              <button className="nav-btn logout-btn" onClick={onLogout}>
                Admin Logout
              </button>
            </>
          )}
          {isUser && (
            <div className="user-info">
              <span className="username">{username}</span>
              <button className="nav-btn logout-btn" onClick={onUserLogout}>
                Logout
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

export default Header;
