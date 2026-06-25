import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@cmc/ui';
import { App } from './App';
import { DesignShowcase } from './design-showcase';

const isDesignPreview = window.location.hash === '#design';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      {isDesignPreview ? <DesignShowcase /> : <App />}
    </AppProviders>
  </StrictMode>,
);
