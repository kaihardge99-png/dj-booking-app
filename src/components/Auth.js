import React, { useState } from 'react';
import './Auth.css';
import ForgotPassword from './ForgotPassword';

function Auth({ onLoginSuccess, onSignupSuccess }) {
  const [isSignup, setIsSignup] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
    setError('');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.username.trim()) {
      setError('Username is required');
      return;
    }
    if (!formData.email.trim()) {
      setError('Email is required');
      return;
    }
    if (!formData.password) {
      setError('Password is required');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('userToken', data.token);
        localStorage.setItem('username', formData.username);
        onSignupSuccess(data.token, formData.username);
      } else {
        setError(data.error || 'Signup failed');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Error creating account');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.username.trim()) {
      setError('Username is required');
      return;
    }
    if (!formData.password) {
      setError('Password is required');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('userToken', data.token);
        localStorage.setItem('username', formData.username);
        onLoginSuccess(data.token, formData.username);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Error logging in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showForgotPassword ? (
        <ForgotPassword onBack={() => setShowForgotPassword(false)} />
      ) : (
        <div className="auth-container">
          <div className="auth-card">
            <h2>{isSignup ? 'Create Account' : 'Sign In'}</h2>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={isSignup ? handleSignup : handleLogin}>
              <div className="form-group">
                <label htmlFor="username">{isSignup ? 'Username' : 'Username or Email'}</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder={isSignup ? 'Enter your username' : 'Enter your username or email'}
                  disabled={loading}
                />
              </div>

              {isSignup && (
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="Enter your email"
                    disabled={loading}
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  disabled={loading}
                />
              </div>

              {isSignup && (
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm your password"
                    disabled={loading}
                  />
                </div>
              )}

              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? (isSignup ? 'Creating Account...' : 'Signing In...') : (isSignup ? 'Create Account' : 'Sign In')}
              </button>
            </form>

            {!isSignup && (
              <div className="forgot-password-link">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="link-btn"
                >
                  Forgot Password?
                </button>
              </div>
            )}

            <div className="auth-toggle">
              <p>
                {isSignup ? 'Already have an account?' : "Don't have an account?"}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignup(!isSignup);
                    setFormData({ username: '', email: '', password: '', confirmPassword: '' });
                    setError('');
                  }}
                  className="toggle-btn"
                >
                  {isSignup ? 'Sign In' : 'Create Account'}
                </button>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Auth;
