# CMCnew — Grounding đề xuất + Brainstorm tích hợp AI

> **Loại:** Research + Brainstorm (KHÔNG code — tuân thủ `/cook` HARD-GATE: chưa plan duyệt thì chưa code)
> **Ngày:** 2026-06-29 · **Branch:** develop
> **Nối tiếp:** `xia-erp-reference-mining-260629-1007-*` (báo cáo khai thác TEKY/AMES)
> **Phương pháp:** 2 subagent song song — (1) reality-check đề xuất vs charter/decisions/roadmap; (2) researcher AI integration. Nguồn đối chiếu: `docs/project-charter.md`, `docs/roadmap.md`, `docs/decisions/0001–0013`, harness matrix.

---

## PHẦN A — Grounding: đề xuất học hỏi vs THỰC TẾ dự án

Mục tiêu (yêu cầu user): tránh "học hỏi mà bỏ qua thực tế dự án → sai hướng". Mỗi đề xuất đã đối chiếu charter + 13 decision.

### A.1 ✅ Khớp thực tế — nên làm (greenlight)

| Mục | Verdict | Căn cứ |
|---|---|---|
| **B1** assignment-log (sổ phân bổ lead) | ALIGNED | user chốt Q1 (giữ log, bỏ row-scoping); phục vụ KPI decision 0011 |
| **B2** attribution kênh (source/medium/campaign) | ALIGNED | charter có role `ctv_mkt` nhưng chưa đo được ROI; chỉ thêm field |
| **B4** lost-reason taxonomy | ALIGNED | rẻ; biến free-text→enum cho funnel |
| **C3** chuyển lớp/cơ sở (+ buổi bù) | ALIGNED — chuyển lớp **đã trong charter §5③** | makeup là mở rộng nhỏ trên Enrollment/Attendance |
| **D1** nghỉ phép · **D2** hợp đồng LĐ | ALIGNED — charter §5 + roadmap **Phase 4** | user chốt Q3: làm sau payroll go-live (~4 tuần) |
| **D4a** lịch ca nhân sự (mutual-exclusion) | ALIGNED — charter §5 | (phụ cấp năng lực/onboarding thì KHÔNG — xem A.2) |
| **E1** idempotency worker | ALIGNED — charter §4 "auto-gen idempotent"; EmailOutbox `dedupKey` đã có | củng cố cron ParentMeeting |
| **E2** pwd-history + mã hoá PII | ALIGNED (2FA scope cần hỏi) | hợp posture decision 0013 |
| **E3** index bảng lớn | ALIGNED | rẻ, proactive |
| **F1** waitlist · **F2** alumni · **F3** địa lý VN | ALIGNED (nhỏ) | mở rộng lifecycle/chuẩn hoá có sẵn |

### A.2 🔴 Lệch thực tế — BỎ hoặc phải hỏi trước (đừng làm theo quán tính)

| Mục | Verdict | XUNG ĐỘT với |
|---|---|---|
| **A1/P0-1** care theo buổi 1/4/9/12 | OUT-OF-CHARTER | charter dùng **họp PH theo cadence** (matrix `ACA-CADENCE` đã implemented) → **xác nhận BỎ** |
| **B3** chia hoa hồng đa-bên (cosell/affiliate) | CONFLICTS | **decision 0011 + 0012**: hoa hồng = **đơn-owner theo quota**. Làm B3 = đổi công thức payroll đã chốt |
| **B5** Zalo ZNS | OUT-OF-CHARTER | **decision 0013**: kênh outbound = **email MS Graph + SSE**. Zalo = provider mới |
| **C1** deferred revenue (DT theo buổi) | CONFLICTS | charter §2 "giữ phiếu thu thủ công" + thu **upfront** trọn gói |
| **C2** trả góp học phí | CONFLICTS | charter §4: học phí **trả trước theo 1/2/3 năm** |
| **F4** membership/VIP tier | OUT-OF-CHARTER | ngoài định vị **decision 0008 (LMS = homework platform)** |
| **E-invoice** | OUT-OF-SCOPE (khóa cứng) | charter §2 + user Q2 hoãn. ⚠️ vẫn là rủi ro pháp lý dài hạn |

### A.3 ⚠️ Đính chính nội bộ
- **D3 person⟂login:** Báo cáo trước ghi "✅ Done" (model `EmploymentProfile` tách `AppUser`) — đúng về **model**, nhưng `EmploymentProfile.userId` đang **unique + bắt buộc** → thực tế **mọi nhân sự vẫn cần 1 tài khoản login**. Muốn quản lý GV thỉnh giảng không-login thì phải nới ràng buộc này (cần user quyết).

### A.4 Câu hỏi grounding cần user quyết
1. **B3** — Thực tế có deal chia hoa hồng >1 người (cosell/CTV giới thiệu) không? (nếu có → cần **decision mới**, đụng payroll)
2. **B5** — Có thêm kênh **Zalo ZNS** ngoài email không? (provider mới, chi phí)
3. **C1/C2** — Có đổi mô hình tài chính: ghi nhận DT theo buổi và/hoặc bán trả góp? (high-risk kế toán)
4. **D3** — Có onboard nhiều GV thỉnh giảng **không cần login** không?
5. **E2** — Bắt buộc 2FA cho nhóm nào (ke_toan/hr/bgd/super_admin)?
6. **F4** — Membership/VIP tier: giữ hay bỏ?

---

## PHẦN B — Brainstorm tích hợp AI (chống FOMO)

Nguyên tắc cứng (theo yêu cầu user): **chỉ AI hoá chỗ thay được việc tay chân lặp lại + tác dụng đo được**; chỗ không rõ tác dụng → từ chối. Mục tiêu = **giải phóng con người**, không gắn AI cho sang. Mọi mục đều **human-in-the-loop** (AI nháp, người duyệt).

### B.1 ⭐ Quick wins — giá trị cao, rủi ro thấp (4 tuần, draft-only)

| # | Vai trò | Việc AI thay | Input có sẵn trong CMC | Tác dụng | Effort |
|---|---|---|---|---|---|
| Q1 | **sale** | Soạn nháp tin tư vấn follow-up | Contact, Opportunity stage, last-message | ~1.5–2.7 giờ/ngày toàn đội sale | 2–3d |
| Q2 | **cskh** | Phân loại + tóm tắt case (issue/impact/next) | `AfterSaleCase.description` + `RecordEvent` chatter | ~1–1.5 giờ/ngày | 3–4d |
| Q3 | **hr** | Flag payslip bất thường (bonus lạ, thiếu BH) | `Payslip` + `SalaryRate` history + policy | chống sai lương trước khi trả | 2–3d |
| Q4 | **ke_toan** | Đối soát phiếu thu vs sao kê (OCR + match) | `Receipt` + ảnh sao kê | ~2–3 giờ/kỳ | 3–4d |
| Q5 | **cron** | Cá nhân hoá nhắc họp PH (tên con/điểm/chuyên cần) | Enrollment, FinalGrade, Attendance, ParentMeeting | tăng tỉ lệ mở/đi họp | 2–3d |

> Tất cả Q1–Q5: **AI nháp → người bấm gửi/duyệt**; mask PII (tên/SĐT/lương) trước khi gọi LLM; validate output qua `domain-*` (vd điểm 0–10, hoa hồng không âm).

### B.2 📈 Chiến lược — giá trị rất cao, cần pilot + A/B test

| # | Việc | Cơ chế | Rủi ro | Điều kiện trước khi làm |
|---|---|---|---|---|
| S-AI-1 | **CSKH tier-1 FAQ** (deflect câu hỏi lặp) | RAG trên KB + rerank, escalate nếu confidence thấp | cao (khách-facing) | phải có KB; pgvector; đo deflection% |
| S-AI-2 | **Tự tính hoa hồng + validate** | structured output, validate qua `domain-payroll` | cao (tài chính) | A/B 10 nhân sự×3 tháng; CallMetric tin cậy |
| S-AI-3 | **Tóm tắt học bạ PH theo tháng** (narrative) | RAG grade+attendance+pillar → narrative PDF | TB (hallucination điểm) | `QualitativeAssessment` phải có dữ liệu thật |

### B.3 🚫 TỪ CHỐI (anti-FOMO) — KHÔNG làm lúc này

| Ý tưởng | Lý do từ chối |
|---|---|
| Auto-chấm bài tự luận **cho điểm chính thức** | hallucination → khiếu nại/pháp lý; chỉ cho **gợi ý điểm**, GV quyết |
| Auto-gửi email phiếu thu/payslip trực tiếp | sai người nhận, mất audit; phải **người bấm gửi** |
| Chatbot tư vấn tuyển sinh trả lời tự do | sai thông tin học phí/lịch → mất uy tín bán hàng |
| Dự đoán churn HS theo cá nhân | dữ liệu sớm + bias + PII profiling; chỉ làm cohort-level + review tay |
| Auto-duyệt after-sale (refund/transfer) | tài chính + trách nhiệm quản lý; AI chỉ **gợi ý**, người duyệt |
| Phiên âm + sentiment cuộc gọi real-time | quyền riêng tư + chi phí; dùng **tóm tắt sau gọi** từ call-log |
| AI tự confirm/approve KPI/payroll | phá separation-of-duties (trái decision 0011) |

### B.4 🛡️ Guardrail bắt buộc (nếu triển khai bất kỳ mục AI nào)
1. **Human-in-the-loop**: AI chỉ nháp; người bấm gửi/duyệt.
2. **Mask PII trước khi gọi LLM** (tên→pseudonym, SĐT/email/lương ẩn); chỉ gửi data tối thiểu; data đã lọc theo facility (RLS).
3. **Validate output qua `domain-*`** (điểm, hoa hồng, số tiền).
4. **Audit + feedback loop**: log mọi call (input đã mask, prompt version, output, hành động người dùng).
5. **Compliance**: cần Data Processing Agreement với nhà cung cấp LLM (PII học sinh VN); retention log ≤ 90 ngày.

### B.5 ❓ Tiền đề chưa rõ — phải xác minh trước khi cam kết AI
1. **Azure OpenAI** — M365 A1 có kèm OpenAI hay phải mua riêng? Chi phí/model?
2. **Vector DB** — dùng `pgvector` (Postgres sẵn có) hay dịch vụ ngoài?
3. **Dữ liệu chất lượng** — `QualitativeAssessment` pillar đã có data thật chưa? `CallMetric` tin cậy tới đâu?
4. **KB cho CSKH** — có sẵn FAQ/wiki hay phải build từ 0?
5. **DPA/GDPR** — đội pháp lý sẵn sàng ký thoả thuận xử lý dữ liệu?

---

## PHẦN C — Menu quyết định hợp nhất (user chốt)

**Nhóm 1 — Greenlight, sẵn sàng vào plan (không xung đột):**
`B1, B2, B4` (sales-ops) · `C3` (chuyển lớp + makeup) · `D1, D2, D4a` (HR Phase 4, sau payroll) · `E1, E2(pwd/PII), E3` (hạ tầng) · `F1, F2, F3` (lifecycle).

**Nhóm 2 — Cần user quyết trước (lệch charter/decision):** `B3, B5, C1, C2, D3, E2-2FA, F4` (xem A.4).

**Nhóm 3 — AI quick wins (cần xác nhận tiền đề B.5):** `Q1–Q5`.
**Nhóm 4 — AI chiến lược (pilot sau):** `S-AI-1/2/3`.
**Nhóm 5 — KHÔNG làm:** B.3 anti-FOMO list + E-invoice (giữ hoãn).

---

## PHẦN D — Câu hỏi mở (tổng)
- Grounding: A.4 (6 câu).
- AI tiền đề: B.5 (5 câu) — **quan trọng nhất: xác nhận Azure OpenAI có sẵn không**, vì toàn bộ Nhóm 3/4 phụ thuộc.
- Thứ tự ưu tiên: muốn ưu tiên **giải phóng nhân lực (AI quick wins)** hay **vá nghiệp vụ nền (sales-ops/HR/hạ tầng)** trước?
</content>
