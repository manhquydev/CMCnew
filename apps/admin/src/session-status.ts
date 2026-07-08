import dayjs from 'dayjs';

/**
 * Trạng thái hiển thị của buổi học SUY THEO GIỜ THỰC — sửa bug "buổi đã qua vẫn hiện Sắp dạy".
 * DB `SessionStatus` chỉ có planned/confirmed/cancelled và KHÔNG tự advance theo thời gian, nên
 * dùng raw status để hiển thị là sai. Ở đây suy ra từ sessionDate + startTime/endTime vs hiện tại:
 * cancelled (terminal) > đã qua endTime = "Đã xong" > trong khung giờ = "Đang học" > tương lai = "Sắp dạy".
 */
export type SessionStage = 'upcoming' | 'ongoing' | 'done' | 'cancelled';

export function effectiveSessionStatus(
  sessionDate: string | Date,
  startTime: string,
  endTime: string,
  rawStatus: string,
): { stage: SessionStage; label: string; color: string } {
  if (rawStatus === 'cancelled') return { stage: 'cancelled', label: 'Đã hủy', color: '#C5221F' };
  const day = dayjs(sessionDate).format('YYYY-MM-DD');
  // ISO datetime string ("2026-07-06T18:00") — parsed natively by dayjs, no customParseFormat plugin.
  const start = dayjs(`${day}T${startTime}`);
  const end = dayjs(`${day}T${endTime}`);
  const now = dayjs();
  if (now.isAfter(end)) return { stage: 'done', label: 'Đã xong', color: '#6E6E73' };
  if (now.isAfter(start)) return { stage: 'ongoing', label: 'Đang học', color: '#137333' };
  return { stage: 'upcoming', label: 'Sắp dạy', color: '#0071E3' };
}

/** Chuỗi stage happy-path cho chevron WorkflowStatusbar (dùng với effectiveSessionStatus().stage). */
export const SESSION_STAGES = [
  { value: 'upcoming', label: 'Sắp dạy' },
  { value: 'ongoing', label: 'Đang học' },
  { value: 'done', label: 'Đã xong' },
];
export const SESSION_TERMINAL = [{ value: 'cancelled', label: 'Đã hủy' }];
