// Email templates. Each kind maps a typed payload → { subject, html }. Rendering happens at enqueue
// time so the stored row is self-contained (the worker never needs the payload again). Copy is
// Vietnamese to match the product. Keep styling inline — many mail clients strip <style> blocks.

export type EmailTemplateKind =
  | 'parent_welcome'
  | 'staff_welcome'
  | 'payslip_ready'
  | 'password_reset'
  | 'account_security_alert'
  | 'parent_meeting'
  | 'level_up';

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
  parent_welcome: { parentName?: string; activationUrl: string; expiresHours: number };
  staff_welcome: { displayName?: string; activationUrl: string; expiresHours: number };
  payslip_ready: { displayName?: string; period: string; viewUrl?: string };
  password_reset: { name?: string; resetUrl: string; expiresMinutes: number };
  account_security_alert: { name?: string; action: string; at: string };
  parent_meeting: { title: string; scheduledAt: string; location?: string | null };
  level_up: { studentName?: string; fromLevel: string; toLevel: string };
}

type Renderer<K extends EmailTemplateKind> = (data: TemplatePayloads[K]) => RenderedEmail;

const renderers: { [K in EmailTemplateKind]: Renderer<K> } = {
  parent_welcome: (d) => ({
    subject: `Kích hoạt tài khoản phụ huynh ${BRAND}`,
    html: layout({
      title: 'Chào mừng đến với hệ thống học tập CMC',
      preheader: 'Kích hoạt tài khoản phụ huynh của bạn',
      bodyHtml:
        p(`Kính gửi ${esc(d.parentName ?? 'Quý phụ huynh')},`) +
        p('Tài khoản phụ huynh của bạn trên hệ thống LMS đã được tạo. Vui lòng kích hoạt và đặt mật khẩu để theo dõi việc học của con.') +
        button('Kích hoạt tài khoản', d.activationUrl) +
        p(`Liên kết có hiệu lực trong ${d.expiresHours} giờ. Nếu hết hạn, vui lòng liên hệ cơ sở để được cấp lại.`),
    }),
  }),
  staff_welcome: (d) => ({
    subject: `Kích hoạt tài khoản nhân sự ${BRAND}`,
    html: layout({
      title: 'Tài khoản nhân sự đã sẵn sàng',
      preheader: 'Kích hoạt tài khoản và đặt mật khẩu',
      bodyHtml:
        p(`Xin chào ${esc(d.displayName ?? 'bạn')},`) +
        p('Tài khoản của bạn trên hệ thống quản trị CMC đã được khởi tạo. Vui lòng kích hoạt và tự đặt mật khẩu.') +
        button('Kích hoạt & đặt mật khẩu', d.activationUrl) +
        p(`Liên kết có hiệu lực trong ${d.expiresHours} giờ.`),
    }),
  }),
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
  password_reset: (d) => ({
    subject: `Đặt lại mật khẩu ${BRAND}`,
    html: layout({
      title: 'Yêu cầu đặt lại mật khẩu',
      preheader: 'Liên kết đặt lại mật khẩu của bạn',
      bodyHtml:
        p(`Xin chào ${esc(d.name ?? 'bạn')},`) +
        p('Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhấn nút bên dưới để tiếp tục.') +
        button('Đặt lại mật khẩu', d.resetUrl) +
        p(`Liên kết có hiệu lực trong ${d.expiresMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu của bạn không thay đổi.`),
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
  level_up: (d) => ({
    subject: 'Chúc mừng: học sinh được lên cấp độ mới',
    html: layout({
      title: 'Lên cấp độ học tập',
      preheader: 'Học sinh vừa được duyệt lên cấp độ mới',
      bodyHtml:
        p('Kính gửi Quý phụ huynh,') +
        p(`Học sinh ${esc(d.studentName ?? '')} đã được duyệt lên cấp độ <strong>${esc(d.toLevel)}</strong> (từ ${esc(d.fromLevel)}). Xin chúc mừng!`),
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
