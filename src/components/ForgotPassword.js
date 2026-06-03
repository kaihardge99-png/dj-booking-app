import React, { useState } from 'react';
import './ForgotPassword.css';

function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Password reset link sent to your email. Please check your inbox.');
        if (data.debugResetLink) {
          setMessage(`Password reset link: ${data.debugResetLink}`);
        }
        setEmail('');
      } else {
        setError(data.error || 'Failed to send reset link');
      }
    } catch (err) {
      setError('Error sending reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-container">
      <div className="forgot-password-box">
        <h2>Reset Password</h2>
        <p className="forgot-password-subtitle">Enter your email to receive a password reset link</p>

        {message && <div className="success-message">{message}</div>}
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        <button className="back-btn" onClick={onBack}>
          Back to Sign In
        </button>
      </div>
    </div>
  );
}

export default ForgotPassword;
