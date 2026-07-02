/** Printable HTML học bạ (transcript). Same print-to-PDF approach as certificate-html.ts —
 * final grades per period plus qualitative assessments, styled for browser print. */

export interface TranscriptFinalGradeRow {
  id: string;
  program: string;
  level: string | null;
  periodKey: string;
  homeworkAvg: number | null;
  testScore: number | null;
  attendanceRate: number | null;
  qualitativeScore: number | null;
  finalScore: number | null;
  passed: boolean;
  complete: boolean;
}

export interface TranscriptQualitativeRow {
  id: string;
  period: string;
  periodKey: string;
  criteria: Record<string, number>;
  narrative: string | null;
}

export interface TranscriptView {
  facilityName: string;
  studentName: string;
  finalGrades: TranscriptFinalGradeRow[];
  qualitative: TranscriptQualitativeRow[];
}

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};
const PERIOD_LABEL: Record<string, string> = {
  MONTHLY: 'Hàng tháng',
  END_LEVEL: 'Cuối cấp độ',
};
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(1));

export function renderTranscriptHtml(v: TranscriptView): string {
  const gradeRows = v.finalGrades
    .map(
      (g) => `<tr>
        <td>${esc(PROGRAM_LABEL[g.program] ?? g.program)}${g.level ? ` · ${esc(g.level)}` : ''}</td>
        <td>${esc(g.periodKey)}</td>
        <td style="text-align:right">${fmt(g.homeworkAvg)}</td>
        <td style="text-align:right">${fmt(g.testScore)}</td>
        <td style="text-align:right">${g.attendanceRate == null ? '—' : `${Math.round(g.attendanceRate * 100)}%`}</td>
        <td style="text-align:right">${fmt(g.qualitativeScore)}</td>
        <td style="text-align:right;font-weight:700">${fmt(g.finalScore)}</td>
        <td>${g.complete ? (g.passed ? 'Đạt' : 'Chưa đạt') : 'Đang học'}</td>
      </tr>`,
    )
    .join('');

  const qualitativeRows = v.qualitative
    .map((q) => {
      const criteria = Object.entries(q.criteria)
        .map(([pillar, score]) => `${esc(pillar)}: ${score}`)
        .join(' · ');
      return `<div class="qa">
        <div class="qa-head">${esc(q.periodKey)} <span class="badge">${esc(PERIOD_LABEL[q.period] ?? q.period)}</span></div>
        ${criteria ? `<div class="qa-criteria">${criteria}</div>` : ''}
        ${q.narrative ? `<div class="qa-narrative">${esc(q.narrative)}</div>` : ''}
      </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Học bạ ${esc(v.studentName)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a2238;margin:0;padding:40px;}
  .sheet{max-width:860px;margin:0 auto;}
  .org{letter-spacing:2px;text-transform:uppercase;color:#777;font-size:13px;}
  h1{font-size:28px;margin:6px 0 2px;color:#b8902a;}
  .name{font-size:20px;font-weight:700;margin:4px 0 20px;}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;}
  th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left;}
  th{text-transform:uppercase;font-size:11px;letter-spacing:0.04em;color:#777;}
  .qa{margin-bottom:14px;font-size:13px;}
  .qa-head{font-weight:700;margin-bottom:4px;}
  .qa-criteria{color:#555;margin-bottom:2px;}
  .qa-narrative{color:#555;}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#eef;font-size:11px;font-weight:400;}
  @media print{button{display:none}}
</style></head>
<body>
  <div class="sheet">
    <div class="org">${esc(v.facilityName)}</div>
    <h1>HỌC BẠ</h1>
    <div class="name">${esc(v.studentName)}</div>

    ${
      v.finalGrades.length > 0
        ? `<table>
      <thead><tr>
        <th>Chương trình</th><th>Kỳ</th><th>Bài tập</th><th>Kiểm tra</th>
        <th>Chuyên cần</th><th>Định tính</th><th>Tổng kết</th><th>Kết quả</th>
      </tr></thead>
      <tbody>${gradeRows}</tbody>
    </table>`
        : '<p>Chưa có điểm tổng kết kỳ nào.</p>'
    }

    ${qualitativeRows}
  </div>
  <div style="text-align:center;margin-top:20px"><button onclick="print()">In học bạ</button></div>
</body></html>`;
}
