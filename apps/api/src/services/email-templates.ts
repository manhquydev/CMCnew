// Email templates. Each kind maps a typed payload → { subject, html }. Rendering happens at enqueue
// time so the stored row is self-contained (the worker never needs the payload again). Copy is
// Vietnamese to match the product. Keep styling inline — many mail clients strip <style> blocks.

export type EmailTemplateKind =
  | 'payslip_ready'
  | 'account_security_alert'
  | 'parent_meeting'
  | 'otp_login';

const BRAND = 'CMC';

/** Shared shell: header + body + footer. `preheader` is the inbox preview snippet. */
function layout(opts: { title: string; preheader?: string; bodyHtml: string }): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2733">
${opts.preheader ? `<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</span>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb">
<tr><td style="background:#0b5cad;padding:20px 28px;color:#fff;font-size:18px;font-weight:600">${BRAND}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#0b1f33">${esc(opts.title)}</h1>
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#fafbfc;color:#8a94a6;font-size:12px;border-top:1px solid #e6e8eb">
Email tự động từ hệ thống ${BRAND}. Vui lòng không trả lời thư này.
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Primary call-to-action button. */
function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px">
<tr><td style="border-radius:8px;background:#0b5cad">
<a href="${esc(url)}" style="display:inline-block;padding:12px 24px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${esc(label)}</a>
</td></tr></table>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333">${text}</p>`;
}

/** Escape user-supplied text before interpolating into HTML. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

// ── Payload types per kind ────────────────────────────────────────────────────────────────────
export interface TemplatePayloads {
  payslip_ready: { displayName?: string; period: string; viewUrl?: string };
  account_security_alert: { name?: string; action: string; at: string };
  parent_meeting: { title: string; scheduledAt: string; location?: string | null };
  otp_login: { code: string; expiresMinutes: number };
}

type Renderer<K extends EmailTemplateKind> = (data: TemplatePayloads[K]) => RenderedEmail;

const renderers: { [K in EmailTemplateKind]: Renderer<K> } = {
  payslip_ready: (d) => ({
    subject: `Phiếu lương kỳ ${esc(d.period)} đã sẵn sàng`,
    html: layout({
      title: 'Phiếu lương đã được chốt',
      preheader: `Phiếu lương kỳ ${d.period}`,
      bodyHtml:
        p(`Xin chào ${esc(d.displayName ?? 'bạn')},`) +
        p(`Phiếu lương kỳ <strong>${esc(d.period)}</strong> của bạn đã được chốt.`) +
        (d.viewUrl ? button('Xem phiếu lương', d.viewUrl) : '') +
        p('Đăng nhập hệ thống để xem chi tiết. Mọi thắc mắc vui lòng liên hệ bộ phận nhân sự/kế toán.'),
    }),
  }),
  account_security_alert: (d) => ({
    subject: `Cảnh báo bảo mật tài khoản ${BRAND}`,
    html: layout({
      title: 'Thông báo thay đổi bảo mật',
      preheader: 'Có thay đổi trên tài khoản của bạn',
      bodyHtml:
        p(`Xin chào ${esc(d.name ?? 'bạn')},`) +
        p(`Tài khoản của bạn vừa có thay đổi: <strong>${esc(d.action)}</strong> lúc ${esc(d.at)}.`) +
        p('Nếu đây không phải hành động của bạn, vui lòng liên hệ quản trị viên ngay.'),
    }),
  }),
  parent_meeting: (d) => ({
    subject: `Nhắc lịch họp phụ huynh: ${esc(d.title)}`,
    html: layout({
      title: 'Nhắc lịch họp phụ huynh',
      preheader: d.title,
      bodyHtml:
        p('Kính gửi Quý phụ huynh,') +
        p(`Buổi họp <strong>${esc(d.title)}</strong> sẽ diễn ra lúc <strong>${esc(d.scheduledAt)}</strong>${d.location ? ` tại ${esc(d.location)}` : ''}.`) +
        p('Kính mong Quý phụ huynh sắp xếp tham dự.'),
    }),
  }),
  otp_login: (d) => ({
    subject: `Mã đăng nhập LMS: ${esc(d.code)}`,
    html: layout({
      title: 'Mã đăng nhập một lần (OTP)',
      preheader: `Mã đăng nhập của bạn: ${d.code}`,
      bodyHtml:
        p('Kính gửi Quý phụ huynh,') +
        p('Mã đăng nhập một lần của bạn là:') +
        `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#0b5cad">${esc(d.code)}</p>` +
        p(`Mã có hiệu lực trong ${d.expiresMinutes} phút và chỉ dùng một lần. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua thư này.`),
    }),
  }),
};

/** Render a template by kind. Throws if the kind is unknown (caller bug). */
export function renderTemplate<K extends EmailTemplateKind>(
  kind: K,
  data: TemplatePayloads[K],
): RenderedEmail {
  const r = renderers[kind] as Renderer<K> | undefined;
  if (!r) throw new Error(`Unknown email template kind: ${kind}`);
  return r(data);
}
