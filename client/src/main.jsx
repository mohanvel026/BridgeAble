// client/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AccessibilityProvider from './components/AccessibilityProvider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <AccessibilityProvider>
    <App />
  </AccessibilityProvider>
);