import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@cmc/ui';
import { App } from './App';
// Self-hosted kid-friendly typography — avoids a Google Fonts network call blocked by CSP in prod.
import '@fontsource-variable/fredoka';
import '@fontsource-variable/quicksand';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <div className="lms-app-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <App />
      </div>
    </AppProviders>
  </StrictMode>,
);
