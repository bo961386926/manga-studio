// Author: forsearch | Updated: 2026-04-30
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AlertProvider } from './components/GlobalAlert';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AlertProvider>
      <App />
    </AlertProvider>
  </React.StrictMode>
);
