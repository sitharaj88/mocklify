import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

console.log('[MockServer WebView] main.tsx loaded');

try {
  const rootElement = document.getElementById('root');
  console.log('[MockServer WebView] Root element:', rootElement);

  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    console.log('[MockServer WebView] React root created, rendering App...');
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('[MockServer WebView] App rendered');
  } else {
    console.error('[MockServer WebView] Root element not found!');
  }
} catch (error) {
  console.error('[MockServer WebView] Error during initialization:', error);
}
