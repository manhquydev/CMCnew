# Agent-05: IP/Location Check-In Feasibility Analysis

**Date:** 2026-06-30
**Context:** Work-shift registration for CMCnew ERP employee attendance
**Stack:** React SPA + tRPC on Hono + PostgreSQL 16 / RLS
**Current state:** Zero IP/geo infrastructure. Facility model exists. EmploymentProfile model exists. No employee attendance/timekeeping module yet.

---

## Executive Summary

**Web-based check-in CANNOT be made cryptographically tamper-proof.** Anyone with browser DevTools, a proxy, or a rooted phone can spoof IP headers, GPS coordinates, or WebRTC responses. The correct framing is: **how much deterrence is enough for your threat model, and what is the audit trail when someone cheats?**

For CMCnew context (Vietnamese education centers, staff of 20-100 per facility, on-premise WiFi), the recommended approach is **Option E Hybrid: WiFi IP check (primary) + QR code rotation (physical presence) + mandatory audit log**. GPS is a nice-to-have fallback for field staff, not a security control.


---

## 1. Threat Model -- Candor First

Before evaluating options, acknowledge what you CANNOT prevent in a browser:

| Attack vector | Difficulty | Can CMCnew stop it? |
|---|---|---|
| Spoof X-Forwarded-For header | Trivial (curl -H) | Yes -- nginx sets x-real-ip, not XFF |
| Fake GPS in Chrome DevTools | Trivial (Sensors tab) | No -- browser-level, invisible to server |
| Screenshot QR code, send to friend | Trivial | No -- unless QR rotates under 30s + camera required |
| Connect to office WiFi, then leave | Trivial | No -- only check-in moment is validated |
| VPN/proxy through office network | Medium (needs office infra) | No -- IP matches office |
| 4G at office (mobile user) | Automatic | No -- IP will not match office WiFi |
| Rooted Android fake GPS at OS level | Medium | No -- OS-level, undetectable from browser |

**The honest conclusion:** Your check-in system is an honor system with friction. The value is in (a) making cheating require effort, (b) audit trails that catch patterns, and (c) HR policy enforcement when abuse is found. If you need cryptographic proof of physical presence, you need dedicated hardware (biometric scanner, NFC badge reader, turnstile with card) -- not a web app.

---

## 2. Detailed Option Analysis

### Option A: Check Client IP

**Mechanism:** Backend reads req.ip (from nginx x-real-ip header), compares against a whitelist of public IPs per facility.

**How CMCnew already does IP extraction** (apps/api/src/context.ts:27): The system correctly uses x-real-ip (nginx-set, client CANNOT forge). Falls back to LAST XFF element (the hop nginx appended), not the forgeable first element.

| Pro | Con |
|---|---|
| Zero client-side code | Dynamic public IP from ISP (VNPT/FPT) changes without notice |
| Already implemented in context.ts | All staff behind NAT share same IP -- cannot distinguish individuals |
| No user permission needed | Mobile on 4G gets different IP -- denied at office |
| Low latency (about 0ms overhead) | VPN users get VPN IP, not office IP |
| No external dependency | Server on cloud sees client home/4G IP, not office LAN IP |

**Verdict:** Viable as ONE layer, not sufficient alone. Public IP whitelist management is an operations headache when ISP rotates IPs.

---

### Option B: Check IP + Local Network Range

**Mechanism:** Backend checks public IP + also looks for local IP match (e.g. 192.168.1.0/24). WebRTC can leak the client local IP via ICE candidates.

| Pro | Con |
|---|---|
| Verifies local network presence | WebRTC blocked by some browsers or privacy settings |
| Works even behind NAT | 4G users on office phone still fail |
| No GPS permission popup | Attacker can modify JS at runtime using DevTools breakpoint |
| No external dependency | Extra 200-500ms for ICE gathering |
| | Safari increasingly blocks this for privacy reasons |

**Verdict:** Clever but fragile. Good as defense-in-depth, not as gatekeeper.

---

### Option C: GPS / Geolocation

**Mechanism:** navigator.geolocation.getCurrentPosition(), compare against facility lat/lng + configurable radius (e.g. 100m).

| Pro | Con |
|---|---|
| Works on 4G and WiFi | **Trivially fakeable** -- Chrome DevTools, Sensors tab, Override |
| Works remotely for field staff | Permission popup every time creates user friction |
| No IP management needed | Indoor GPS accuracy poor at 10-50m error |
| Requires HTTPS, already have | Some browsers throttle or deny in background |
| | Drains phone battery if checked frequently |

**Verdict:** Useful for field staff (sale, CTV) who work outside the office. NOT a primary security control.

---

### Option D: QR Code at Facility

**Mechanism:** A dynamic QR code displayed on a screen at the facility entrance. Staff scan it with their phone camera. The QR encodes a short-lived server-signed token.

**Architecture:** Facility display screen polls server every 30 seconds for new QR. Staff scans QR with phone camera. Phone browser sends qrToken + userId to backend. Backend validates token is not expired, not reused, and belongs to the correct facility.

| Pro | Con |
|---|---|
| Physical presence required (must see screen) | Photo of QR sent to remote colleague, mitigated by rotating every 30s |
| Works on any device with camera | Needs a display screen at each facility entrance |
| No IP or GPS complexity | Extra hardware needed (old tablet or TV plus Raspberry Pi) |
| No browser permission needed | UX friction: pull out phone, open camera, scan |
| Cannot be faked remotely (server-signed, short-lived) | I forgot my phone edge case |

**Verdict:** The strongest physical-presence guarantee of all web-only options. Rotation period is the key trade-off: 30 seconds deters photo-sharing; 5 minutes is more user-friendly but weaker.

---

### Option E: Hybrid (Recommended Baseline)

**Mechanism:** Layered approach -- no single layer is the gatekeeper, but the combination raises the cost of cheating.

Flow:
1. Staff opens check-in page
2. Layer 1: IP check (x-real-ip in whitelist?) --> MATCH --> check-in granted
3. If NO MATCH: Layer 2: Local IP via WebRTC? OR Fallback: QR scan or GPS
4. If any layer PASSES --> check-in granted + audit log with IP, UA, timestamp, method

**Config per facility:**
- publicIpCidrs: string[] (e.g. 113.161.77.0/24)
- localIpCidrs: string[] (e.g. 192.168.1.0/24)
- geoLat, geoLng, geoRadiusMeters (optional)
- qrRotateSeconds: number (default 30, 0 = disabled)
- allowedMethods: list of enabled methods (ip, local_ip, gps, qr)

## 3. Recommended Architecture for CMCnew

### 3.1 The Honest Recommendation

**Phase 1 (MVP -- weeks 1-2):** IP check only + audit log + manual override. Accept that it is weak security. The real goal is to build the shift registration and timesheet infrastructure. The location check is a checkbox until you have physical hardware.

**Phase 2 (hardening -- month 2):** Add QR code rotation on a display screen at each facility. This is the cheapest way to get meaningful physical-presence verification.

**Phase 3 (field staff -- month 3):** Add GPS fallback for sale/CTV/marketing staff who work outside the office.

**NOT recommended now:** Biometric scanners, NFC badges, turnstile integration. These require capital expenditure and physical installation. Start with software, learn the real abuse patterns, then invest in hardware where it matters.

### 3.2 Schema Extension -- Facility Model

Minimal addition to Facility model (no new tables needed for MVP):

```prisma
model Facility {
  // ... existing fields (id, code, name, timezone, address, etc) ...
  
  // NEW: network configuration for check-in validation
  checkinPublicIpCidrs  String[]  @default([])
  checkinLocalIpCidrs   String[]  @default([])
  checkinGeoLat         Float?
  checkinGeoLng         Float?
  checkinGeoRadiusM     Int       @default(100)
  checkinQrRotateSec    Int       @default(30)
  checkinMethods        String[]  @default(["ip"])
}
```

### 3.3 New Models

```prisma
/// Staff check-in/check-out record (separate from student Attendance)
model WorkAttendance {
  id          String    @id @default(uuid()) @db.Uuid
  facilityId  Int
  userId      String    @db.Uuid
  shiftId     String?   @db.Uuid
  checkInAt   DateTime
  checkOutAt  DateTime?
  method      WorkAttMethod
  clientIp    String
  userAgent   String?
  geoLat      Float?
  geoLng      Float?
  verified    Boolean   @default(false)
  note        String?
  createdAt   DateTime  @default(now())
  
  @@index([facilityId, checkInAt])
  @@index([userId, checkInAt])
  @@map("work_attendance")
}

enum WorkAttMethod {
  ip
  local_ip
  gps
  qr
  manual
}

/// Rotating QR token (short-lived, one-time-use)
model CheckinQrToken {
  id           String    @id @default(uuid()) @db.Uuid
  facilityId   Int
  token        String    @unique
  expiresAt    DateTime
  usedAt       DateTime?
  usedByUserId String?   @db.Uuid
  createdAt    DateTime  @default(now())
  
  @@index([facilityId, expiresAt])
  @@index([token])
  @@map("checkin_qr_token")
}
```

### 3.4 API Design (tRPC Router)

```typescript
// apps/api/src/routers/work-attendance.ts
import { z } from "zod";
import { router, protectedProcedure, requirePermission } from "../trpc.js";

export const workAttendanceRouter = router({
  checkIn: protectedProcedure
    .input(z.object({
      facilityId: z.number().int().positive(),
      method: z.enum(["ip", "local_ip", "gps", "qr"]),
      geoLat: z.number().optional(),
      geoLng: z.number().optional(),
      qrToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Load facility network config
      // 2. Validate based on method
      // 3. Create WorkAttendance record
      // 4. Audit log via logEvent()
    }),

  manualCheckIn: requirePermission("work_attendance", "override")
    .input(z.object({
      userId: z.string().uuid(),
      facilityId: z.number().int().positive(),
      reason: z.string().min(10),
    }))
    .mutation(/* ... */),

  getQrToken: protectedProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(/* ... */),

  checkOut: protectedProcedure
    .input(z.object({ attendanceId: z.string().uuid() }))
    .mutation(/* ... */),
});
```

### 3.5 IP Validation Middleware

```typescript
// apps/api/src/checkin-ip-guard.ts
export function validateCheckinIp(
  clientIp: string,
  localIp: string | undefined,
  facility: { checkinPublicIpCidrs: string[]; checkinLocalIpCidrs: string[] },
): { passed: boolean; method: "ip" | "local_ip" | "none"; matchedCidr?: string } {
  for (const cidr of facility.checkinPublicIpCidrs) {
    if (ipMatchesCidr(clientIp, cidr)) {
      return { passed: true, method: "ip", matchedCidr: cidr };
    }
  }
  if (localIp) {
    for (const cidr of facility.checkinLocalIpCidrs) {
      if (ipMatchesCidr(localIp, cidr)) {
        return { passed: true, method: "local_ip", matchedCidr: cidr };
      }
    }
  }
  return { passed: false, method: "none" };
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [range, bits = "32"] = cidr.split("/");
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}
```

### 3.6 Configuration UI (Admin Panel)

In Facility management, add a "Check-in Config" tab:

```
Facility: CMC Cau Giay
---------------------------------
[x] IP Check Enabled
    Public IP CIDRs:  [113.161.77.0/24    ] [Add]
    Local IP CIDRs:   [192.168.1.0/24     ] [Add]
                       [10.0.0.0/8        ] [Add]

[ ] GPS Check Enabled
    Latitude:   [21.0285  ]
    Longitude:  [105.8542 ]
    Radius (m): [100      ]

[x] QR Code Enabled
    Rotation:  [30] seconds
    Display URL: https://hoc.cmcvn.edu.vn/checkin/qr/1

[x] Fallback: supervisor manual override
```

## 4. Security Risk Mitigation

### Risk 1: X-Forwarded-For Header Injection

**Already mitigated.** context.ts uses x-real-ip (set by nginx to the real TCP peer). It deliberately does NOT use X-Forwarded-For[0] which is attacker-controlled. Verify nginx config has:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### Risk 2: GPS Spoofing in DevTools

**Cannot be prevented.** Mitigations:
- GPS is a secondary method, not the gatekeeper
- Audit log records which method was used
- Pattern detection: if staff always checks in via GPS but IP is from a different city, flag for review

### Risk 3: QR Code Photo Sharing

Mitigation: Rotate QR every 30 seconds. The display screen shows a countdown timer. A photo sent to a remote colleague is useless after 30 seconds. A livestream would work but requires real-time coordination.

### Risk 4: Replay Attacks

- Each QR token is single-use (consumed on first use, usedAt set)
- Each check-in is idempotent per (userId, date, facilityId)

### Risk 5: 4G Users at Office

Staff who connect via 4G instead of WiFi will fail IP check. Mitigations:
- QR code is the primary fallback (scan the office display)
- GPS can work if physically present
- HR policy: "connect to office WiFi for check-in" is a reasonable expectation

### Risk 6: Dynamic ISP IP

When ISP rotates the office public IP, ALL staff are locked out. Mitigations:
- Use local IP ranges as primary check (192.168.x.x never changes)
- Auto-detect: if IP check fails for many staff in short window, alert facility manager
- Provide "report check-in outage" button for staff

## 5. Migration Path

```
Week 1-2:  Schema migration + basic IP check + WorkAttendance model
           |
           v
Week 3:    QR code rotation endpoint + display page
           |
           v
Week 4:    GPS fallback for field staff
           |
           v
Month 2:   Pattern detection / anomaly dashboard
           |
           v
Month 3+:  Evaluate hardware (biometric, NFC) based on real abuse data
```

Each phase is independently deployable. The IP-check-only MVP is deliberately weak -- it exists to prove the timesheet/shift infrastructure, not to be the final security solution.

---

## 6. Trade-Off Matrix

| Dimension | IP Only (A) | IP+Local (B) | GPS (C) | QR (D) | Hybrid (E) |
|---|---|---|---|---|---|
| **Security strength** | 2/10 | 3/10 | 3/10 | 7/10 | 7/10 |
| **UX friction** | None | Low (WebRTC) | Medium (permission) | Medium (scan) | Low-Medium |
| **Infrastructure cost** | 0 USD | 0 USD | 0 USD | 100-300/display | 0-300 USD |
| **4G support** | No | No | Yes | Yes | Yes |
| **VPN support** | No | Maybe | Yes | Yes | Yes |
| **Field staff** | No | No | Yes | No | Yes |
| **Spoof difficulty** | Trivial | Low | Trivial | Medium | Medium |
| **Maintenance** | High (IP updates) | Medium | Low | Low | Medium |
| **Implementation effort** | 1 day | 2 days | 1 day | 3 days | 5 days |

## 7. Unresolved Questions (for product owner)

1. **What is the actual abuse scenario you are defending against?** Staff claiming to be at office but working from home? Staff sending a friend to check in for them? This determines which layers to invest in.

2. **What percentage of staff work outside the office?** If 80%+ are always at the facility, IP check covers most cases. If many are field staff such as sale or CTV, GPS is more important.

3. **What is the budget for physical hardware per facility?** A cheap Android tablet at around 100 USD plus wall mount at around 20 USD per entrance is sufficient for QR display. Biometric scanners cost 200-500 USD per unit.

4. **Is there a VN labor law requirement for timekeeping?** Vietnam Labor Code 2019, Article 108 allows electronic timekeeping. Does an IP-based web check-in satisfy legal requirements, or does it need to be a dedicated device?

5. **What happens when check-in fails?** Is the staff member unpaid for that day? Can a supervisor override? This policy decision affects the architecture, requiring a manual override endpoint.

6. **Do you have a VPN server for remote staff?** If yes, VPN IP ranges can be whitelisted. If no, remote staff can only use GPS or QR, which is impossible to do remotely for QR.

7. **Multi-facility: can a staff member check in at facility A while assigned to facility B?** The RLS model allows this if both are in UserFacility list. Should it be allowed or blocked?

---

## 8. Simplest Viable Option

**Start with IP check + manual override + audit log.** That is 2 days of work:

1. Add checkinPublicIpCidrs and checkinLocalIpCidrs to Facility model
2. Create WorkAttendance model and migration
3. Create workAttendance.checkIn tRPC endpoint with IP validation
4. Create workAttendance.manualCheckIn for supervisor override
5. Log every attempt, success AND failure, to RecordEvent using existing audit infrastructure

This gives you:
- A working timesheet system immediately
- Low security, IP-based only, but acceptable as v1
- The data pipeline to detect abuse patterns before investing in hardware
- Manual override as the universal escape hatch

Add QR code in month 2 once you have real usage data.

---

## Appendix: What Would Make This Good Enough

A web-based check-in system reaches good enough for most businesses when:

1. Cheating requires **active, real-time coordination** between two people, for example livestreaming a QR code, not passive sharing like a screenshot
2. The **audit trail is complete** with IP, method, timestamp, and user agent so HR can investigate suspicious patterns
3. There is a **policy consequence** for falsifying attendance, emphasizing deterrence not just prevention
4. A **manual override escape hatch** exists so the system never blocks legitimate work

CMCnew can achieve all four with the Hybrid approach.

---

**Status:** Analysis complete. Awaiting product owner decisions on unresolved questions before implementation planning.
