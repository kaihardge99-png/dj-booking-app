import React from 'react';
import ReactDOM from 'react-dom/client';

function TestApp() {
  return React.createElement('div', null, 'Hello from React!');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(TestApp));
