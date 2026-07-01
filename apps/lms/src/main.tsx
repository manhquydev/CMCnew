import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@cmc/ui';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <div className="lms-app-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <App />
      </div>
    </AppProviders>
  </StrictMode>,
);
