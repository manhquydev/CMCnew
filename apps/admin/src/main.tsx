import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@cmc/ui';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
