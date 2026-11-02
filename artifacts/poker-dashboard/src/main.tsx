import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { IS_DEMO } from '@/lib/demo-flag';

import './index.css';

// The demo answers /api requests in the browser, so it must be in place before anything fetches.
if (IS_DEMO) {
  const { installDemoApi } = await import('@/demo/mock-api');
  installDemoApi();
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Offline support and installability. Production only, so dev servers never get a stale cache.
if (import.meta.env.PROD && !IS_DEMO && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn('Service worker registration failed', error));
  });
}

// Lets cards show a soft glow that follows the pointer (see .soft-shadow in index.css).
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.addEventListener(
    'pointermove',
    (event) => {
      const card = (event.target as Element | null)?.closest?.('.soft-shadow') as HTMLElement | null;
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    },
    { passive: true },
  );
}
