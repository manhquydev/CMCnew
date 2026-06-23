/** Printable HTML certificate (chứng chỉ). Vietnamese-clean, styled for print-to-PDF. */

export interface CertificateView {
  id: string;
  facilityName: string;
  studentName: string;
  program: string;
  level: string | null;
  title: string;
  issuedAt: Date;
}

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderCertificateHtml(c: CertificateView): string {
  const serial = `CC-${c.issuedAt.getFullYear()}-${c.id.slice(0, 8).toUpperCase()}`;
  const levelLine = c.level ? `Cấp độ ${esc(c.level)} · ` : '';
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Chứng chỉ ${esc(serial)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a2238;margin:0;padding:40px;}
  .cert{max-width:760px;margin:0 auto;border:6px double #b8902a;border-radius:10px;padding:48px;text-align:center;}
  .org{letter-spacing:2px;text-transform:uppercase;color:#777;font-size:13px;}
  h1{font-size:34px;margin:18px 0 6px;color:#b8902a;}
  .name{font-size:30px;font-weight:700;margin:22px 0 6px;}
  .body{font-size:16px;color:#333;margin:8px 0;}
  .meta{margin-top:28px;color:#555;font-size:14px;}
  .serial{margin-top:18px;color:#999;font-size:12px;letter-spacing:1px;}
  @media print{button{display:none}}
</style></head>
<body>
  <div class="cert">
    <div class="org">${esc(c.facilityName)}</div>
    <h1>CHỨNG CHỈ</h1>
    <div class="body">Chứng nhận học sinh</div>
    <div class="name">${esc(c.studentName)}</div>
    <div class="body">đã hoàn thành <b>${esc(c.title)}</b></div>
    <div class="body">${levelLine}Chương trình ${esc(PROGRAM_LABEL[c.program] ?? c.program)}</div>
    <div class="meta">Ngày cấp: ${c.issuedAt.toLocaleDateString('vi-VN')}</div>
    <div class="serial">Số: ${esc(serial)}</div>
  </div>
  <div style="text-align:center;margin-top:20px"><button onclick="print()">In chứng chỉ</button></div>
</body></html>`;
}
