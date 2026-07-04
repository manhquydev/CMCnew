// Email templates. Each kind maps a typed payload → { subject, html }. Rendering happens at enqueue
// time so the stored row is self-contained (the worker never needs the payload again). Copy is
// Vietnamese to match the product. Keep styling inline — many mail clients strip <style> blocks.

export type EmailTemplateKind =
  | 'payslip_ready'
  | 'account_security_alert'
  | 'parent_meeting'
  | 'otp_login'
  | 'lms_account_ready'
  | 'account_welcome'
  | 'ops_error_alert'
  | 'receipt';

/**
 * Brand identity for outbound email — the REAL CMC EDU public info (mirrors the LMS login footer).
 * Hardcoded because it is stable public marketing data; the logo is the live LMS-served asset so it
 * loads in mail clients that show remote images (alt text covers clients that block them).
 */
const BRAND = {
  name: 'CMC EDU',
  fullName: 'Học viện phát triển Tư duy & Năng lực số CMC',
  tagline: 'Tò mò là khởi nguồn của trí tuệ',
  logoUrl: 'https://hoc.cmcvn.edu.vn/brand/cmc-logo.jpg',
  hotline: '0856 636 398',
  email: 'contact@cmcvn.edu.vn',
  website: 'cmcvn.edu.vn',
  websiteUrl: 'https://cmcvn.edu.vn',
  address: 'Khu đô thị Tây Nam Linh Đàm, Hoàng Mai, Hà Nội',
  facebook: 'https://www.facebook.com/share/14fVk5g2DiT/',
  zalo: 'https://zaloapp.com/qr/p/1boqvt2eg3ndl',
  lmsUrl: 'https://hoc.cmcvn.edu.vn',
};

/**
 * Shared shell — the fixed structure every system email shares:
 *   [preheader] → [logo header] → [title + body] → [footer: brand · contact · do-not-reply]
 * Inline styles only (mail clients strip <style>). Table layout for Outlook.
 */
function layout(opts: { title: string; preheader?: string; bodyHtml: string }): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2733">
${opts.preheader ? `<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</span>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb">
<tr><td align="center" style="padding:22px 28px;background:#ffffff;border-bottom:3px solid #0b5cad">
<img src="${BRAND.logoUrl}" alt="${esc(BRAND.name)}" height="42" style="height:42px;width:auto;border:0;display:inline-block">
</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#0b1f33">${esc(opts.title)}</h1>
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:22px 28px;background:#fafbfc;color:#8a94a6;font-size:12px;line-height:1.65;border-top:1px solid #e6e8eb">
<strong style="color:#5b6573;font-size:13px">${esc(BRAND.fullName)}</strong><br>
<span style="color:#9aa3b0">${esc(BRAND.tagline)}</span>
<div style="margin:10px 0 0">
Hotline: <a href="tel:${BRAND.hotline.replace(/\s/g, '')}" style="color:#0b5cad;text-decoration:none">${esc(BRAND.hotline)}</a>
&nbsp;·&nbsp; Email: <a href="mailto:${BRAND.email}" style="color:#0b5cad;text-decoration:none">${esc(BRAND.email)}</a>
&nbsp;·&nbsp; <a href="${BRAND.websiteUrl}" style="color:#0b5cad;text-decoration:none">${esc(BRAND.website)}</a><br>
${esc(BRAND.address)}<br>
<a href="${BRAND.facebook}" style="color:#0b5cad;text-decoration:none">Facebook</a>
&nbsp;·&nbsp; <a href="${BRAND.zalo}" style="color:#0b5cad;text-decoration:none">Zalo</a>
</div>
<div style="margin:12px 0 0;color:#aab2bd">Email tự động từ hệ thống ${esc(BRAND.name)}. Vui lòng không trả lời thư này.</div>
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
  /** Sent to parent when a StudentAccount is provisioned at receipt.approve. Family login
   *  (parent phone + fixed default password) is the primary path; loginCode is the break-glass
   *  fallback for when the family has no usable phone. */
  lms_account_ready: {
    parentName?: string;
    studentName: string;
    /** Bare 84xxx family-login phone — omitted when the parent's phone didn't normalize. */
    familyPhone?: string;
    loginCode: string;
    /** Plaintext temp password — rendered here, never stored. */
    tempPassword: string;
  };
  /** Sent to a staff member when their AppUser is created. SSO onboarding: no password is sent —
   *  staff sign in with their Microsoft (CMC EDU) account. roleLabel is a human-readable role name. */
  account_welcome: {
    displayName?: string;
    loginUrl: string;
    roleLabel?: string;
  };
  /** Sent to ops when the error-rate window crosses ERROR_ALERT_THRESHOLD. No PII — counts only. */
  ops_error_alert: {
    windowStart: string;
    count: number;
    threshold: number;
  };
  /** Sent to the payer on finance.sendReceiptEmail. Non-secret — retryable and re-sendable. */
  receipt: {
    receiptCode: string;
    netAmount: number;
    studentName: string;
    facilityName: string;
    approvedAt: string;
  };
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
    subject: `Cảnh báo bảo mật tài khoản ${BRAND.name}`,
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
    // Keep the one-time code OUT of the subject — it would otherwise show in the inbox list and the
    // device notification preview (a security anti-pattern). The code lives only in the body.
    subject: `Mã đăng nhập LMS ${BRAND.name}`,
    html: layout({
      title: 'Mã đăng nhập một lần (OTP)',
      preheader: 'Mã đăng nhập một lần để vào cổng học tập CMC EDU',
      bodyHtml:
        p('Kính gửi Quý phụ huynh,') +
        p('Mã đăng nhập một lần của bạn là:') +
        `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#0b5cad">${esc(d.code)}</p>` +
        p(`Mã có hiệu lực trong ${d.expiresMinutes} phút và chỉ dùng một lần. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua thư này.`),
    }),
  }),

  lms_account_ready: (d) => ({
    subject: `Tài khoản LMS của ${esc(d.studentName)} đã sẵn sàng`,
    html: layout({
      title: 'Tài khoản LMS học sinh đã được tạo',
      preheader: d.familyPhone ? `Đăng nhập bằng SĐT ${d.familyPhone}` : `Mã đăng nhập: ${d.loginCode}`,
      bodyHtml:
        p(`Kính gửi ${esc(d.parentName ?? 'Quý phụ huynh')},`) +
        p(`Tài khoản LMS của con bạn <strong>${esc(d.studentName)}</strong> đã được tạo thành công.`) +
        (d.familyPhone
          ? p('Cách đăng nhập chính: dùng số điện thoại phụ huynh và mật khẩu chuẩn.') +
            `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden">
<tr><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600;width:140px">Số điện thoại</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0b5cad;letter-spacing:1px">${esc(d.familyPhone)}</td></tr>
<tr style="border-top:1px solid #e6e8eb"><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600">Mật khẩu</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#333;letter-spacing:1px">${esc(d.tempPassword)}</td></tr>
</table>` +
            p(`Nếu nhiều con cùng dùng SĐT này, sau khi đăng nhập bạn sẽ chọn đúng hồ sơ con để vào.`) +
            p(`Dự phòng (khi không dùng được SĐT): mã học sinh <strong>${esc(d.loginCode)}</strong> + mật khẩu trên.`)
          : p('Thông tin đăng nhập:') +
            `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden">
<tr><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600;width:140px">Mã học sinh (ID)</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0b5cad;letter-spacing:1px">${esc(d.loginCode)}</td></tr>
<tr style="border-top:1px solid #e6e8eb"><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600">Mật khẩu</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#333;letter-spacing:1px">${esc(d.tempPassword)}</td></tr>
</table>`) +
        button('Đăng nhập LMS', BRAND.lmsUrl) +
        p('Vui lòng bảo quản thông tin đăng nhập này.') +
        p('Nếu bạn có câu hỏi, hãy liên hệ với nhà trường để được hỗ trợ.'),
    }),
  }),

  account_welcome: (d) => ({
    subject: `Chào mừng bạn đến với hệ thống ${BRAND.name}`,
    html: layout({
      title: 'Tài khoản nhân viên đã được tạo',
      preheader: 'Đăng nhập bằng tài khoản CMC EDU (Microsoft)',
      bodyHtml:
        p(`Xin chào ${esc(d.displayName ?? 'bạn')},`) +
        p(
          `Tài khoản của bạn trên hệ thống ${BRAND.name} đã được tạo${
            d.roleLabel ? ` với vai trò <strong>${esc(d.roleLabel)}</strong>` : ''
          }.`,
        ) +
        p(
          'Đăng nhập bằng <strong>tài khoản CMC EDU (Microsoft)</strong> của bạn — chọn ' +
            '"Đăng nhập bằng tài khoản CMC EDU". Hệ thống không gửi mật khẩu riêng; bạn dùng đúng ' +
            'mật khẩu Microsoft đã được cấp.',
        ) +
        button('Mở hệ thống', d.loginUrl) +
        p('Nếu bạn chưa nhận được tài khoản Microsoft, vui lòng liên hệ bộ phận IT.'),
    }),
  }),

  ops_error_alert: (d) => ({
    subject: `[CMC EDU] Cảnh báo tỉ lệ lỗi tăng cao (${d.count} lỗi)`,
    html: layout({
      title: 'Cảnh báo vận hành: tỉ lệ lỗi tăng cao',
      preheader: `${d.count}/${d.threshold} lỗi trong cửa sổ ${d.windowStart}`,
      bodyHtml:
        p(`Hệ thống ghi nhận <strong>${d.count}</strong> lỗi kể từ ${esc(d.windowStart)}, vượt ngưỡng cảnh báo (${d.threshold}).`) +
        p('Vui lòng kiểm tra log máy chủ để xác định nguyên nhân.'),
    }),
  }),

  receipt: (d) => ({
    subject: `Phiếu thu ${esc(d.receiptCode)} — ${BRAND.name}`,
    html: layout({
      title: 'Phiếu thu học phí',
      preheader: `Phiếu thu ${d.receiptCode}`,
      bodyHtml:
        p('Kính gửi Quý phụ huynh,') +
        p(`Đính kèm là phiếu thu học phí cho học sinh <strong>${esc(d.studentName)}</strong> tại ${esc(d.facilityName)}.`) +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden">
<tr><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600;width:140px">Mã phiếu thu</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0b5cad">${esc(d.receiptCode)}</td></tr>
<tr style="border-top:1px solid #e6e8eb"><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600">Số tiền</td>
<td style="padding:12px 16px;font-size:15px;font-weight:700;color:#333">${d.netAmount.toLocaleString('vi-VN')}đ</td></tr>
<tr style="border-top:1px solid #e6e8eb"><td style="padding:12px 16px;background:#f8f9fb;font-size:13px;color:#555;font-weight:600">Ngày duyệt</td>
<td style="padding:12px 16px;font-size:15px;color:#333">${esc(d.approvedAt)}</td></tr>
</table>` +
        p('Cảm ơn Quý phụ huynh đã tin tưởng đồng hành cùng chúng tôi.'),
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
