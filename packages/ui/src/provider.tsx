import '@cmc/ui/tokens.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { ReactNode } from 'react';
import { theme } from './theme.js';

/** Wrap each app once. Mounts the toast portal so notify*() helpers render everywhere. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      {children}
    </MantineProvider>
  );
}
