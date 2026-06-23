/** Printable HTML receipt (phiếu thu). Vietnamese-clean (browser Unicode), styled for
 * print-to-PDF — the manual-receipt delivery path (no online payment in scope). */

export interface ReceiptView {
  code: string | null;
  facilityName: string;
  studentName: string;
  courseLabel: string;
  period: string | null;
  yearsPrepaid: number;
  annualPrice: number;
  grossAmount: number;
  tierPercent: number;
  voucherPercent: number;
  effectiveDiscountPercent: number;
  netAmount: number;
  status: string;
  createdAt: Date;
  approvedAt: Date | null;
}

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderReceiptHtml(r: ReceiptView): string {
  const date = r.approvedAt ?? r.createdAt;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td>${esc(label)}</td><td style="text-align:right${strong ? ';font-weight:700' : ''}">${esc(value)}</td></tr>`;
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Phiếu thu ${esc(r.code ?? '')}</title>
<style>
  body{font-family:system-ui,'Segoe UI',Arial,sans-serif;color:#1a1a1a;margin:0;padding:32px;}
  .sheet{max-width:520px;margin:0 auto;border:1px solid #ddd;border-radius:8px;padding:28px;}
  h1{font-size:20px;margin:0 0 2px;}
  .muted{color:#777;font-size:13px;}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;}
  td{padding:6px 0;border-bottom:1px solid #f0f0f0;}
  .total td{border-top:2px solid #333;border-bottom:none;font-size:16px;padding-top:10px;}
  .badge{display:inline-block;padding:2px 10px;border-radius:12px;background:#eef;font-size:12px;}
  @media print{button{display:none}}
</style></head>
<body>
  <div class="sheet">
    <h1>PHIẾU THU</h1>
    <div class="muted">${esc(r.facilityName)} · Số: <b>${esc(r.code ?? '(nháp)')}</b> · ${date.toLocaleDateString('vi-VN')}</div>
    <table>
      ${row('Học sinh', r.studentName)}
      ${row('Khóa học', r.courseLabel)}
      ${r.period ? row('Kỳ', r.period) : ''}
      ${row('Đóng trước', `${r.yearsPrepaid} năm`)}
      ${row('Đơn giá/năm', vnd(r.annualPrice))}
      ${row('Thành tiền gốc', vnd(r.grossAmount))}
      ${row('Giảm theo năm', `${r.tierPercent}%`)}
      ${r.voucherPercent ? row('Voucher', `${r.voucherPercent}%`) : ''}
      ${row('Giảm áp dụng (trần 35%)', `${r.effectiveDiscountPercent}%`)}
      <tr class="total"><td>Phải thu</td><td style="text-align:right;font-weight:700">${esc(vnd(r.netAmount))}</td></tr>
    </table>
    <p class="muted" style="margin-top:16px">Trạng thái: <span class="badge">${esc(r.status)}</span></p>
    <button onclick="print()">In phiếu</button>
  </div>
</body></html>`;
}
