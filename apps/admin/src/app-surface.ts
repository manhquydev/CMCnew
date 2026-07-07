import type { SectionKey } from './shell';

export type AppSurface = 'erp' | 'teacher';

export const TEACHER_SURFACE_TARGET_ROLES = new Set([
  'giao_vien',
  'giam_doc_kinh_doanh',
  'giam_doc_dao_tao',
]);

export const TEACHER_SURFACE_SECTIONS = new Set<SectionKey>([
  'overview',
  'schedule',
  'attendance',
  'attendance-report',
  'grading',
  'assessment',
  'classes',
  'courses',
  'student-mgmt',
  'meetings',
  'levelup',
  'students',
  'guardians',
  'family-intake',
  'edu-director-cockpit',
  'biz-director-cockpit',
  'profile',
]);

export function currentAppSurface(): AppSurface {
  if (typeof window === 'undefined') return 'erp';
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  if (surfaceParam === 'teacher') {
    window.sessionStorage.setItem('cmc.appSurfaceOverride', 'teacher');
    return 'teacher';
  }
  if (surfaceParam === 'erp') {
    window.sessionStorage.removeItem('cmc.appSurfaceOverride');
    return 'erp';
  }

  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'teacher.cmcvn.edu.vn' || hostname === 'devteacher.cmcvn.edu.vn') {
    return 'teacher';
  }
  if (window.sessionStorage.getItem('cmc.appSurfaceOverride') === 'teacher') {
    return 'teacher';
  }
  return 'erp';
}

export function isTeacherSurfaceRole(roles: readonly string[], isSuperAdmin = false): boolean {
  return isSuperAdmin || roles.some((role) => TEACHER_SURFACE_TARGET_ROLES.has(role));
}

export function isTeacherSurfaceSection(section: SectionKey): boolean {
  return TEACHER_SURFACE_SECTIONS.has(section);
}

export function erpHrefForSection(section: SectionKey): string {
  if (typeof window === 'undefined') return `https://erp.cmcvn.edu.vn/${section}`;
  if (window.location.hostname === 'teacher.cmcvn.edu.vn') {
    return `https://erp.cmcvn.edu.vn/${section}`;
  }
  return `/${section}`;
}

export const SURFACE_COPY: Record<AppSurface, {
  topbarBrand: string;
  topbarContext: string;
  loginTitle: string;
  loginBrandWord: string;
  loginDescription: string;
  loginHeroDescription: string;
}> = {
  erp: {
    topbarBrand: 'CMC',
    topbarContext: 'ERP',
    loginTitle: 'CMC Staff',
    loginBrandWord: 'ERP',
    loginDescription: 'Đăng nhập để truy cập hệ thống quản lý & vận hành.',
    loginHeroDescription:
      'Hệ thống quản lý tích hợp ERP dành cho ban giám đốc, giảng viên và nhân sự vận hành.',
  },
  teacher: {
    topbarBrand: 'CMC Teacher Lite',
    topbarContext: 'Teacher Lite',
    loginTitle: 'CMC Teacher Lite',
    loginBrandWord: 'Teacher Lite',
    loginDescription: 'Đăng nhập để vào quy trình nội bộ đơn giản cho lớp học và LMS.',
    loginHeroDescription:
      'Không gian làm việc gọn cho giám đốc, giáo viên, phụ huynh và học sinh trên cùng dữ liệu LMS.',
  },
};
