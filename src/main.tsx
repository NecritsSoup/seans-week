import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { initTheme } from './theme/theme';
import './styles/global.css';

initTheme();

// Offline-capable app shell (no-op in dev; emitted by vite-plugin-pwa).
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
