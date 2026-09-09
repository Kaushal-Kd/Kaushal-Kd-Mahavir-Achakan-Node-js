import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.jsx';
import './styles/index.css';

// Prevent mouse wheel from changing focused number inputs.
window.addEventListener(
  'wheel',
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== 'number') return;
    if (document.activeElement !== target) return;
    event.preventDefault();
  },
  { passive: false }
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
