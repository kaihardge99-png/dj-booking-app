// Make React and ReactDOM available globally from CDN
window.React = window.React || {};
window.ReactDOM = window.ReactDOM || {};

// Import our app
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  React.createElement(React.StrictMode, null, React.createElement(App))
);
