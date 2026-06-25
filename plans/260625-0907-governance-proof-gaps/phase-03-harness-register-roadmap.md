---
phase: 3
title: "Harness story registration + roadmap update"
status: pending
priority: P2
dependencies: [1, 2]
---

# Phase 03: Harness story registration + roadmap update

## Overview

Sau khi phase 01 (TEST_MATRIX) và phase 02 (E2E) hoàn thành: cập nhật harness `story update` với evidence mới (E2E column), cập nhật `docs/roadmap.md` để done-gates phản ánh bằng chứng thật (harness record + E2E) thay vì self-reported `✅`.

## Requirements

- Functional:
  - `harness-cli story update --id <id> --e2e 1` cho mỗi smoke test đã PASS
  - `docs/roadmap.md` done-gates: thay thế `done-by-evidence (self-reported)` → `done-by-evidence: int-test [file], harness [story-id], e2e [spec-file]`
  - Roadmap gate definition cập nhật: "done = harness record tồn tại + int-test PASS"
- Non-functional:
  - Không thay đổi bất kỳ logic code nào
  - Không xóa existing `✅` — chỉ bổ sung evidence pointer

## Related Code Files

- Modify: `docs/roadmap.md`
- CLI: `scripts/bin/harness-cli.exe story update`
- CLI: `scripts/bin/harness-cli.exe story verify`
- CLI: `scripts/bin/harness-cli.exe query matrix`

## Implementation Steps

### Bước 1: Verify harness story records từ phase 01

```bash
.\scripts\bin\harness-cli.exe query matrix
```

Expect: ≥9 entries (1 existing CV5-hr-ui + 8 mới từ phase 01).

### Bước 2: Update E2E column cho stories có smoke PASS

```bash
# Sau khi smoke test admin PASS:
.\scripts\bin\harness-cli.exe story update --id "US-SEC-01" --e2e 1

# Lặp cho từng story có E2E coverage:
# - Admin smoke → covers: US-SEC-01 (RLS via protected route), admin-level stories
# - LMS smoke → covers: guardian stories, student stories
# - Teaching smoke → covers: academic/payroll stories
```

### Bước 3: Cập nhật roadmap done-gates

Trong `docs/roadmap.md`, mỗi item có `✅ done` hoặc `done-by-evidence`, thêm dòng evidence:

**Trước:**
```
_(✅ done-by-evidence 2026-06-25 — AfterSaleCase CRUD + transition...; khóa bằng aftersale-student-lifecycle.int.test.ts 3 tests.)_
```

**Sau:**
```
_(✅ done-by-evidence 2026-06-25 — AfterSaleCase CRUD + transition...; harness: US-AFS-01 [story add 2026-06-25]; int-test: apps/api/test/aftersale-student-lifecycle.int.test.ts [3 cases]; e2e: teaching-smoke [login guard])_
```

Cập nhật cho: Phase 4 CV5-HR-UI, Phase 5 After-sale, Phase 5 Guardian, Phase 5 Parent-meeting cadence.

### Bước 4: Cập nhật gate definition ở cuối roadmap

Thêm/sửa đoạn "Nguyên tắc gate":

```markdown
## Nguyên tắc done-evidence (đã cập nhật 2026-06-25)

Mỗi phase chỉ "done" khi:
1. **Harness story record** tồn tại (`harness-cli story add --id ... --contract ...`)
2. **Integration test** PASS (`*.int.test.ts` kiểm tra tầng DB + RLS + business rule)
3. **E2E smoke** PASS cho surface hiển thị với user (kể từ 2026-06-25)

"done-by-evidence" = cả 3 điều kiện trên; thiếu 1 = "partially-done".
Không còn `✅` self-reported không có harness record.
```

### Bước 5: Final verify

```bash
# Check harness matrix đầy đủ
.\scripts\bin\harness-cli.exe query matrix

# Check story verify (nếu --verify command được set)
.\scripts\bin\harness-cli.exe story verify-all

# Check TEST_MATRIX không còn empty
grep -c "|" docs/TEST_MATRIX.md
```

## Success Criteria

- [ ] `harness-cli query matrix` hiện ≥9 rows, tất cả có ID không phải `CV5-hr-ui`
- [ ] ≥3 stories có `e2e: yes` sau khi E2E smoke PASS
- [ ] `docs/roadmap.md` không còn `done-by-evidence` không có harness pointer
- [ ] Gate definition cuối roadmap đã cập nhật với 3-điều-kiện
- [ ] `docs/TEST_MATRIX.md` còn ≥40 rows sau phase 01

## Risk Assessment

**Risk:** Smoke tests FAIL → không thể set `--e2e 1`.
**Mitigation:** Ghi `--e2e 0` thành thật. Không inflate evidence. Document lý do fail trong roadmap.

**Risk:** Roadmap update quá verbose, khó đọc.
**Mitigation:** Dùng footnote style: `[^evi-aftersale]` thay vì inline dài. Hoặc tạo section `## Evidence Registry` tách biệt.
