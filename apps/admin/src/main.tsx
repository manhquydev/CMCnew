import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@cmc/ui';
import { DatesProvider } from '@mantine/dates';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
// Self-hosted Inter — Vietnamese Enterprise Core spec. Admin/teaching only;
// LMS keeps its own Fredoka/Quicksand branding and must not load this.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { App } from './App';

// Toàn bộ date/time picker của app phải hiển thị tiếng Việt (tên tháng, thứ trong tuần...).
// Đặt locale một lần ở root thay vì vá từng nơi gọi DatePicker/DateTimePicker.
dayjs.locale('vi');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <DatesProvider settings={{ locale: 'vi' }}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DatesProvider>
    </AppProviders>
  </StrictMode>,
);
