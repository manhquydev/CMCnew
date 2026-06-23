import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { theme } from './theme.js';

/** Wrap each app once. Apps add <Notifications/> + its CSS themselves if needed. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {children}
    </MantineProvider>
  );
}
