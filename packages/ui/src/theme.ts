import { createTheme, type MantineColorsTuple } from '@mantine/core';

const cmc: MantineColorsTuple = [
  '#e7f1ff',
  '#cfe2ff',
  '#9ec5ff',
  '#6aa6ff',
  '#3f8bff',
  '#247bff',
  '#0066cc', // primary (brand)
  '#0058b0',
  '#004a96',
  '#003c7a',
];

export const theme = createTheme({
  primaryColor: 'cmc',
  colors: { cmc },
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  defaultRadius: 'md',
});
