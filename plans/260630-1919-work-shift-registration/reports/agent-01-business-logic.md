# Phan tich nghiep vu: Dang ky cong ca + Cham cong

**Ngay:** 2026-06-30 | **Tac gia:** Brainstormer Agent | **Trang thai:** Draft -- cho human review

---

## 1. Tong quan

2 module chinh: **Shift Registration** + **Check-in/Checkout**. Lien ket nguoc vao Payslip.

---

## 2. State Machine

### 2.1 Shift Registration Form



- DRAFT: Nhan vien tao phieu, tich chon ca theo ngay, Save nhap / Submit gui duyet
- SUBMITTED: Manager/Next Level Manager duyet. Co the Pull back ve Draft
- APPROVED: Co hieu luc, dung de cham cong hang ngay
- SUPERSEDED: Bi vo hieu hoa khi phieu moi duoc APPROVED trung khoang ngay

### 2.2 Check-in/Checkout



- Chi 1 ban ghi/ngay/user. Check-out khi chua check-in -> BAD_REQUEST. Check-in 2 lan -> CONFLICT

---

## 3. Phan tich nghiep vu chi tiet

### 3.1 Phan loai nhom nhan vien

**VAN DE CRITICAL:** EmploymentProfile.position la free-text string, khong phai enum.
Khong the dung position de phan loai nhom mot cach tin cay.

**DE XUAT:** Dung AppUser.roles de phan loai:

| Nhom | Roles | Hanh vi |
|------|-------|---------|
| Kinh doanh | sale, cskh, ctv_mkt | Chon DUNG 1 ca/ngay, 3 ca co dinh 8 tieng |
| Giao vien | giao_vien, head_teacher | Chon NHIEU ca/ngay, 3 ca co dinh 4 tieng |
| Khac | quan_ly, hr, ke_toan, bgd... | **Q1:** Co can dang ky ca khong? |

### 3.2 Dinh nghia ca lam viec

**Nhom Kinh doanh (chon 1 ca/ngay):**

| Ca | Gio | Nghi | Gio cong |
|----|-----|------|----------|
| Ca 1 | 8h30-18h00 | 12h00-13h30 | 8 tieng |
| Ca 2 | 10h00-20h00 | 12h00-13h30 | 8 tieng |
| Ca 3 | 13h00-21h00 | 30p giua ca | 8 tieng |

**Nhom Giao vien (chon nhieu ca/ngay):**

| Ca | Gio | Gio cong |
|----|-----|----------|
| Ca 1 | 8h00-12h00 | 4 tieng |
| Ca 2 | 13h00-17h00 | 4 tieng |
| Ca 3 | 17h00-21h00 | 4 tieng |

**Q2:** Ca 3 Kinh doanh "nghi giua ca 30p" nam o dau? Co dinh hay tu chon?
**Q3:** Giao vien chon ca 3 ca = 12 tieng/ngay -- hop le khong? Gioi han?

### 3.3 Cau truc du lieu de xuat




### 3.3 Cau truc du lieu de xuat



### 3.3 Data Models (xem ERD o cuoi bao cao)

### 3.4 Edge Cases

**Supersede logic:** Phieu B duoc APPROVED, overlap voi A -> A = SUPERSEDED.
Q5: Phieu moi chong lan MOT PHAN ngay -> xu ly ra sao?
Q6: Supersede -> check-in/check-out qua khu co bi anh huong?

**Kiem tra ngay nghi phep:** CRITICAL - CHUA CO Leave model. Q7: Timeline?

**Validation khi Submit:**
1. fromDate < toDate  2. fromDate >= today  3. Co it nhat 1 ca
4. Kinh doanh: moi ngay <= 1 ca  5. Giao vien: khong gioi han
6. Validate ngay nghi phep (neu co)  7. Khong submit trung khoang

**Check-in/Checkout validation:**
Q8: Co cho phep check-in khong can ca? Q9: Muon -> chan hay ghi late?


---

## 4. Integration Points

### 4.1 EmploymentProfile
- Phan loai nhom: Dung AppUser.roles (sale/cskh/ctv_mkt vs giao_vien/head_teacher)
- facilityId: Moi ban ghi shift deu facility-scoped
- position: Hien thi chuc danh tren UI (khong dung de phan loai)
- CRITICAL GAP: KHONG co managerId -> can them hoac resolve qua role hierarchy

### 4.2 Manager Resolution (CRITICAL GAP)
Hien tai KHONG co managerId trong EmploymentProfile. De xuat:
- Them managerId (nullable) vao EmploymentProfile
- Fallback: sale/cskh/ctv_mkt -> giam_doc_kinh_doanh; giao_vien/head_teacher -> giam_doc_dao_tao; Next Level = bgd

### 4.3 Payslip (payslipCompute)
Diem tich hop quan trong nhat. Hien tai payslipCompute nhan workdays thu cong. 3 PA:
- PA A: workdays = COUNT(ngay co check-in + check-out) -- nguyen ngay
- PA B: workdays = SUM(gio check-out - check-in) / 8 -- theo gio
- PA C: workdays = lay tu phieu APPROVED (bo qua check-in/out thuc te)
Q10: Chon PA nao?

### 4.4 KpiScore
Mo rong criterion cham_cong = ty le ngay check-in / tong ngay dang ky.
Second-order effect, khong can implement ngay.

### 4.5 Audit + Permission
- logEvent: entityType=shift_registration, type=status_changed (pattern KPI+Payslip)
- PERMISSIONS: shiftRegistration[create,submit,approve,list,get] + checkin[checkin,checkout,history]

---
## 5. IP Validation -- Phan tich and De xuat

### 5.1 Thach thuc
| Thach thuc | Mo ta | Muc do |
|-----------|-------|--------|
| IP dong | IP WAN thay doi (DHCP ISP, restart modem) | CAO |
| Multi-facility | Moi co so co IP khac nhau | CAO |
| Remote work | Sales gap khach, GV day online | TRUNG BINH |
| VPN bypass | VPN vao mang cong ty tu bat ky dau | THAP |

### 5.2 4 Phuong an

**PA 1: IP Whitelist (KISS) -- DE XUAT MVP**
- FacilityTrustedIp: moi facility co 1+ dai IP tin cay (CIDR matching)
- Check-in: so khop client IP voi bang
- Uu: Don gian, du dung cho MVP
- Nhuoc: IP thay doi -> cap nhat thu cong

**PA 2: IP + WiFi SSID (Hybrid)**
- Uu: Linh hoat hon. Nhuoc: Frontend-dependent, SSID fake duoc

**PA 3: Trust-but-verify (De xuat nang cao)**
- Layer 1: IP check -> PASS. Layer 2: ip_mismatch -> manager review
- Layer 3: Auto-accept learned IP
- Uu: Khong block cung. Nhuoc: Phuc tap hon

**PA 4: QR Code / Geo-fencing**
- Uu: An toan nhat. Nhuoc: Can mobile app, over-engineered

### 5.3 De xuat
- Chon PA 1 cho MVP, nang cap PA 3 sau
- Luon luu IP client vao StaffAttendance.ipAddress (audit)
- Super_admin quan ly trusted IPs qua admin panel
- Fallback: khong co IP cau hinh -> bo qua check (warning log)

### 5.4 Ky thuat lay IP client
Sau Cloudflare/reverse proxy: doc X-Forwarded-For hoac CF-Connecting-IP.
Can verify cach lay IP trong codebase hien tai.

---
## 6. Rui ro and 12 Cau hoi mo

### 6.1 Rui ro ky thuat
| Rui ro | Muc do | Giai thich |
|--------|--------|-----------|
| Chua co Leave model | CRITICAL | Khong validate ngay nghi phep |
| EmploymentProfile.position free-text | HIGH | Phai dung AppUser.roles thay the |
| Khong co managerId | HIGH | Can them vao EmploymentProfile |
| IP validation fragility | MEDIUM | IP thay doi, multi-facility, remote work |
| Supersede logic chong lan | MEDIUM | Can xu ly qua khu vs tuong lai |
| Conflict ClassSession vs ca dang ky | HIGH | GV co lich day khac ca dang ky |

### 6.2 Rui ro nghiep vu
| Rui ro | Muc do |
|--------|--------|
| Sales/CSKH ngoai van phong -> IP fail | HIGH |
| GV co ClassSession khac ca dang ky | HIGH |
| Thay doi ca dot xuat | MEDIUM |
| Part-time / CTV | MEDIUM |

### 6.3 12 Cau hoi Mo (TONG HOP)
| # | Cau hoi | Uu tien |
|---|---------|---------|
| Q1 | quan_ly, bgd, hr, ke_toan co dang ky ca? Nhom nao? | CAO |
| Q2 | Ca 3 Kinh doanh nghi giua ca 30p o dau? | TRUNG BINH |
| Q3 | Giao vien 12 tieng/ngay hop le? Gioi han? | CAO |
| Q4 | Ca da dang ky trong thang la summary table? | TRUNG BINH |
| Q5 | Phieu moi chong lan MOT PHAN -> xu ly the nao? | CAO |
| Q6 | Supersede -> check-in qua khu co bi anh huong? | CAO |
| Q7 | He thong nghi phep xay rieng? Timeline? | CAO |
| Q8 | Check-in khong can dang ky ca? | CAO |
| Q9 | Check-in muon -> chan hay ghi late? | TRUNG BINH |
| Q10 | Cong thuc ngay cong: PA A (nguyen ngay), PA B (theo gio), PA C (theo ca)? | CAO |
| Q11 | Sales/CSKH ngoai van phong -> check-in the nao? | CAO |
| Q12 | ClassSession khac ca dang ky -> uu tien cai nao? | CAO |

---
## 7. De xuat trien khai (phan ky)

### Phase 1: Core Shift Registration (MVP)
- Model: ShiftRegistration + ShiftRegDetail + FacilityTrustedIp
- Workflow: Draft -> Submitted -> Approved -> Superseded (theo pattern KPI)
- Router: shiftRegistration (CRUD + submit + approve + list)
- UI: Form dang ky ca voi bang chon ca theo ngay
- Phan loai nhom dua tren AppUser.roles
- CHUA validate ngay nghi phep (cho Leave module)
- CHUA tich hop Payslip

### Phase 2: Check-in/Checkout
- Model: StaffAttendance (checkInTime, checkOutTime, ipAddress, userId, date)
- Router: checkin (checkin, checkout, history)
- IP validation voi FacilityTrustedIp (PA 1 - KISS)
- Validate ca da dang ky APPROVED moi duoc check-in
- Audit log moi check-in/out

### Phase 3: Integration
- Ket noi Payslip.payslipCompute: auto-fill workdays tu cham cong
- Ket noi Leave module (neu da co)
- Mo rong KPI criterion cham_cong

---

## 8. Quyet dinh kien truc can chot

Truoc khi implementation, can chot cac quyet dinh sau:

1. Phan loai nhom dung AppUser.roles (khong dung EmploymentProfile.position)
2. IP validation: PA 1 (KISS) cho MVP, nang cap PA 3 sau
3. Workflow: Draft -> Submitted -> Approved (bo buoc Confirmed)
4. Supersede: chi vo hieu ngay TUONG LAI, qua khu giu nguyen
5. Check-in yeu cau co ca APPROVED cho ngay do (bat buoc)
6. Workdays = so ngay co check-in+check-out hop le (PA A)

---

## Appendix A: Codebase Patterns

- KPI workflow: apps/api/src/routers/payroll.ts:735-918 (draft->submitted->confirmed->approved)
- Tree auth: apps/api/src/lib/kpi-authz.ts (canOverrideKpi pattern)
- Audit pattern: withRls -> validate -> mutate -> logEvent (moi mutation)
- Permission: requirePermission(module, action) thay requireRole (apps/api/src/trpc.ts:69-77)
- Roles hien co: super_admin, quan_ly, head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd, giam_doc_kinh_doanh, giam_doc_dao_tao
- EmploymentProfile: userId (unique), facilityId, position (free-text!), grade, dependents, callioExt, startedAt -> KHONG co managerId
- Payslip: workdays input thu cong -> auto-fill la target Phase 3
- KPI: da co auto-fill training (chuyen_mon + tuan_thu) -> mo rong them cham_cong
- Attendance: hien tai CHI co student attendance (ClassSession.attendances) -> CHUA co staff attendance

---

## Appendix B: ERD So Bo

AppUser (id, roles, displayName)
  +-- EmploymentProfile (userId unique, position, grade, facilityId)
  +-- ShiftRegistration (id, userId, facilityId, fromDate, toDate, status)
  |     +-- ShiftRegDetail (registrationId, date, shift1, shift2, shift3, totalHours)
  +-- StaffAttendance (userId, facilityId, date unique, checkInTime, checkOutTime, ipAddress)

FacilityTrustedIp (facilityId, ipAddress, label, isActive)

Payslip (workdays <- computed from StaffAttendance)

---

Status: DONE
Summary: Phan tich nghiep vu hoan chinh: state machine, edge cases, integration points, 12 cau hoi mo, de xuat 3 phase + kien truc.
Concerns: 12 cau hoi mo can stakeholder clarify. Rui ro CRITICAL: chua co Leave module, khong co managerId. Rui ro HIGH: position free-text, ClassSession conflict voi ca dang ky cua GV.
