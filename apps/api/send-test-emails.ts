/**
 * Email test harness — renders every email template with representative sample data, writes an HTML
 * preview per template (for visual QA), and optionally SENDS each to a test address via Microsoft
 * Graph (the real sender). Run locally → previews only (Graph unconfigured = no-op). Run inside the
 * prod api container with `--send <addr>` → real delivery.
 *
 *   tsx send-test-emails.ts                         # write previews to ./email-previews/
 *   tsx send-test-emails.ts --send manhquydev@gmail.com   # also send all 6 via Graph
 *
 * Dev/test artifact — not part of the app runtime. Safe: it only reads templates + sends to the
 * address you pass; it never touches the DB or the outbox.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTemplate, type EmailTemplateKind, type TemplatePayloads } from './src/services/email-templates.js';
import { sendEmailNow, type MailboxKey } from './src/lib/graph-client.js';

// One representative payload + sender mailbox per template kind.
const CASES: { [K in EmailTemplateKind]: { mailbox: MailboxKey; data: TemplatePayloads[K] } } = {
  payslip_ready: {
    mailbox: 'payroll',
    data: { displayName: 'Nguyễn Văn A (TEST)', period: '2026-06', viewUrl: 'https://erp.cmcvn.edu.vn' },
  },
  account_security_alert: {
    mailbox: 'notify',
    data: { name: 'Nguyễn Văn A (TEST)', action: 'Cập nhật vai trò tài khoản', at: '28/06/2026 12:00' },
  },
  parent_meeting: {
    mailbox: 'notify',
    data: { title: 'Họp phụ huynh lớp Tư duy 1 (TEST)', scheduledAt: '01/07/2026 18:00', location: 'Phòng 201 — CMC Linh Đàm' },
  },
  otp_login: {
    mailbox: 'notify',
    data: { code: '123456', expiresMinutes: 5 },
  },
  lms_account_ready: {
    mailbox: 'notify',
    data: { parentName: 'Phụ huynh Test', studentName: 'Bé An (TEST)', loginCode: 'HQ-HS-0001', tempPassword: 'Abc12345' },
  },
  account_welcome: {
    mailbox: 'notify',
    data: { displayName: 'Giáo viên Test', loginUrl: 'https://erp.cmcvn.edu.vn', roleLabel: 'Giáo viên' },
  },
};

async function main() {
  const sendIdx = process.argv.indexOf('--send');
  const to = sendIdx >= 0 ? process.argv[sendIdx + 1] : null;
  const previewDir = resolve(process.cwd(), 'email-previews');
  mkdirSync(previewDir, { recursive: true });

  const kinds = Object.keys(CASES) as EmailTemplateKind[];
  console.log(`\n=== Email harness — ${kinds.length} templates ===`);
  if (to) console.log(`SEND mode → ${to} (via Microsoft Graph)`);
  else console.log('PREVIEW mode → writing HTML files only (pass --send <addr> to deliver)');

  const results: string[] = [];
  for (const kind of kinds) {
    const c = CASES[kind];
    const rendered = renderTemplate(kind, c.data);
    const subject = `[TEST] ${rendered.subject}`;

    // Always write a preview file for visual QA.
    const file = resolve(previewDir, `${kind}.html`);
    writeFileSync(file, rendered.html, 'utf8');

    if (!to) {
      results.push(`  • ${kind.padEnd(24)} preview → ${file}`);
      continue;
    }

    try {
      const sent = await sendEmailNow({ mailbox: c.mailbox, to, subject, html: rendered.html });
      results.push(`  ${sent ? '✓' : '∅'} ${kind.padEnd(24)} ${sent ? `SENT (mailbox=${c.mailbox})` : 'NO-OP (Graph not configured)'}`);
    } catch (e) {
      results.push(`  ✗ ${kind.padEnd(24)} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(results.join('\n'));
  console.log(`\nPreviews written to: ${previewDir}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
