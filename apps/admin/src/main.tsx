import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@cmc/ui';
import { DatesProvider } from '@mantine/dates';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
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
