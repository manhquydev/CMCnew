import type { SectionKey } from './shell';
import type { AppSurface } from './app-surface';

export type LinkPreviewMetadata = {
  title: string;
  description: string;
};

export const ADMIN_DEFAULT_METADATA: LinkPreviewMetadata = {
  title: 'CMC ERP | Cổng nhân sự',
  description:
    'Cổng ERP CMC dành cho nhân sự: giảng dạy, học sinh, CRM, tài chính, nhân sự và vận hành trung tâm.',
};

export const ADMIN_CRM_OPPORTUNITY_METADATA: LinkPreviewMetadata = {
  title: 'Cơ hội CRM | CMC ERP',
  description: 'Mở hồ sơ cơ hội CRM để theo dõi tư vấn, chủ sở hữu, trạng thái và chăm sóc tuyển sinh tại CMC.',
};

export const TEACHER_DEFAULT_METADATA: LinkPreviewMetadata = {
  title: 'CMC Teacher | Lịch dạy & LMS',
  description:
    'Không gian làm việc cho giáo viên và đào tạo: lịch dạy, lớp học, điểm danh, nhận xét LMS và chấm bài.',
};

export const ADMIN_SECTION_METADATA = {
  overview: {
    title: 'Tổng quan | CMC ERP',
    description: 'Xem nhanh tình hình vận hành, chỉ số trung tâm và các việc cần chú ý trong hệ thống ERP CMC.',
  },
  courses: {
    title: 'Khóa học | CMC ERP',
    description: 'Tra cứu chương trình, khóa học và kỳ học đang dùng cho đào tạo tại Creative Maieutic Center.',
  },
  students: {
    title: 'Học sinh | CMC ERP',
    description: 'Quản lý hồ sơ học sinh, trạng thái học tập, lớp đang theo học và thông tin liên quan tại CMC.',
  },
  org: {
    title: 'Cơ sở & Người dùng | CMC ERP',
    description: 'Quản lý cơ sở, tài khoản nhân sự, vai trò và thông tin tổ chức trong hệ thống ERP CMC.',
  },
  guardians: {
    title: 'Phụ huynh | CMC ERP',
    description: 'Tra cứu phụ huynh, liên kết học sinh và thông tin liên hệ phục vụ chăm sóc gia đình học viên.',
  },
  'family-intake': {
    title: 'Tiếp nhận phụ huynh + học sinh | CMC Teacher',
    description: 'Tạo phiếu nháp từ một form phụ huynh và học sinh để chuyển sang luồng provisioning đã chốt.',
  },
  finance: {
    title: 'Tài chính | CMC ERP',
    description: 'Quản lý phiếu thu, học phí, voucher, công nợ và nghiệp vụ tài chính trong hệ thống ERP CMC.',
  },
  crm: {
    title: 'CRM | CMC ERP',
    description: 'Quản lý cơ hội, tư vấn tuyển sinh, chủ sở hữu và pipeline chăm sóc khách hàng trong CRM CMC.',
  },
  cskh: {
    title: 'Chăm sóc khách hàng | CMC ERP',
    description: 'Theo dõi case CSKH, lịch sử chăm sóc và tình trạng hỗ trợ phụ huynh, học sinh sau ghi danh.',
  },
  rewards: {
    title: 'Đổi quà | CMC ERP',
    description: 'Duyệt yêu cầu đổi quà, kiểm tra sao thưởng và xử lý phần thưởng học tập cho học sinh CMC.',
  },
  schedule: {
    title: 'Lịch dạy | CMC ERP',
    description: 'Quản lý lịch dạy, buổi học, phòng học và liên kết lớp trong hệ thống vận hành đào tạo CMC.',
  },
  attendance: {
    title: 'Điểm danh | CMC ERP',
    description: 'Ghi nhận điểm danh, trạng thái vắng mặt và dữ liệu chuyên cần của học sinh theo từng buổi học.',
  },
  grading: {
    title: 'Chấm bài | CMC ERP',
    description: 'Chấm bài, phản hồi kết quả luyện tập và cập nhật điểm học tập cho học sinh trong lớp CMC.',
  },
  assessment: {
    title: 'Học bạ | CMC ERP',
    description: 'Theo dõi học bạ, đánh giá định kỳ và kết quả học tập theo chương trình đào tạo của CMC.',
  },
  classes: {
    title: 'Lớp học | CMC ERP',
    description: 'Quản lý lớp, batch, danh sách học sinh, lịch học và các hoạt động vận hành lớp tại CMC.',
  },
  meetings: {
    title: 'Họp phụ huynh | CMC ERP',
    description: 'Theo dõi lịch họp phụ huynh, trạng thái xác nhận và nhắc lịch theo lớp trong hệ thống CMC.',
  },
  levelup: {
    title: 'Duyệt cấp độ | CMC ERP',
    description: 'Xem đề xuất lên cấp, quyết định duyệt cấp độ và theo dõi tiến trình học tập của học sinh CMC.',
  },
  hr: {
    title: 'Nhân sự & Lương | CMC ERP',
    description: 'Quản lý hồ sơ nhân sự, bảng lương, phiếu lương và trạng thái chi trả trong hệ thống ERP CMC.',
  },
  kpi: {
    title: 'Đánh giá KPI | CMC ERP',
    description: 'Theo dõi phiếu đánh giá KPI, tiêu chí, điểm tự động và luồng xác nhận hiệu suất nhân sự CMC.',
  },
  compensation: {
    title: 'Cơ cấu lương | CMC ERP',
    description: 'Cấu hình bậc lương, hoa hồng, tham số đãi ngộ và chính sách thu nhập cho nhân sự CMC.',
  },
  'my-payslips': {
    title: 'Phiếu lương của tôi | CMC ERP',
    description: 'Xem phiếu lương cá nhân, trạng thái thanh toán và thông tin thu nhập được phép truy cập.',
  },
} satisfies Partial<Record<SectionKey, LinkPreviewMetadata>>;

export const ADMIN_ROUTE_METADATA = [
  { path: 'overview', metadata: ADMIN_SECTION_METADATA.overview },
  { path: 'courses', metadata: ADMIN_SECTION_METADATA.courses },
  { path: 'students', metadata: ADMIN_SECTION_METADATA.students },
  { path: 'org', metadata: ADMIN_SECTION_METADATA.org },
  { path: 'guardians', metadata: ADMIN_SECTION_METADATA.guardians },
  { path: 'family-intake', metadata: ADMIN_SECTION_METADATA['family-intake'] },
  { path: 'finance', metadata: ADMIN_SECTION_METADATA.finance },
  { path: 'crm', metadata: ADMIN_SECTION_METADATA.crm },
  { path: 'crm/opportunities', metadata: ADMIN_CRM_OPPORTUNITY_METADATA },
  { path: 'cskh', metadata: ADMIN_SECTION_METADATA.cskh },
  { path: 'rewards', metadata: ADMIN_SECTION_METADATA.rewards },
  { path: 'schedule', metadata: ADMIN_SECTION_METADATA.schedule },
  { path: 'attendance', metadata: ADMIN_SECTION_METADATA.attendance },
  { path: 'grading', metadata: ADMIN_SECTION_METADATA.grading },
  { path: 'assessment', metadata: ADMIN_SECTION_METADATA.assessment },
  { path: 'classes', metadata: ADMIN_SECTION_METADATA.classes },
  { path: 'meetings', metadata: ADMIN_SECTION_METADATA.meetings },
  { path: 'levelup', metadata: ADMIN_SECTION_METADATA.levelup },
  { path: 'hr', metadata: ADMIN_SECTION_METADATA.hr },
  { path: 'kpi', metadata: ADMIN_SECTION_METADATA.kpi },
  { path: 'compensation', metadata: ADMIN_SECTION_METADATA.compensation },
  { path: 'my-payslips', metadata: ADMIN_SECTION_METADATA['my-payslips'] },
] as const;

const ADMIN_SECTION_METADATA_BY_KEY: Partial<Record<SectionKey, LinkPreviewMetadata>> = ADMIN_SECTION_METADATA;

const TEACHER_SECTION_TITLES: Partial<Record<SectionKey, string>> = {
  schedule: 'Lịch dạy',
  attendance: 'Điểm danh',
  'attendance-report': 'Báo cáo điểm danh',
  grading: 'Chấm bài',
  assessment: 'Học bạ',
  classes: 'Lớp học',
  courses: 'Học liệu',
  'student-mgmt': 'Học viên',
  meetings: 'Họp phụ huynh',
  levelup: 'Duyệt cấp độ',
  students: 'Học viên',
  guardians: 'Phụ huynh',
  'family-intake': 'Tiếp nhận phụ huynh + học sinh',
  'edu-director-cockpit': 'Điều phối đào tạo',
  'biz-director-cockpit': 'Bàn giao tuyển sinh',
  'payroll-checkin': 'Chấm công & lương',
  'shift-registration': 'Đăng ký ca',
  checkin: 'Chấm công',
  profile: 'Hồ sơ',
};

export function getAdminMetadata(
  section: SectionKey,
  isCrmOpportunity: boolean,
  surface: AppSurface = 'erp',
): LinkPreviewMetadata {
  if (surface === 'teacher') {
    const title = TEACHER_SECTION_TITLES[section];
    if (!title) return TEACHER_DEFAULT_METADATA;
    return {
      title: `${title} | CMC Teacher`,
      description: TEACHER_DEFAULT_METADATA.description,
    };
  }
  if (isCrmOpportunity) return ADMIN_CRM_OPPORTUNITY_METADATA;
  return ADMIN_SECTION_METADATA_BY_KEY[section] ?? ADMIN_DEFAULT_METADATA;
}

function findOrCreateMeta(attributeName: 'name' | 'property', attributeValue: string): HTMLMetaElement {
  const existingMeta = document.head.querySelector<HTMLMetaElement>(`meta[${attributeName}="${attributeValue}"]`);
  if (existingMeta) return existingMeta;

  const createdMeta = document.createElement('meta');
  createdMeta.setAttribute(attributeName, attributeValue);
  document.head.appendChild(createdMeta);
  return createdMeta;
}

export function applyAdminMetadata(metadata: LinkPreviewMetadata) {
  document.title = metadata.title;
  findOrCreateMeta('name', 'description').content = metadata.description;
  findOrCreateMeta('property', 'og:title').content = metadata.title;
  findOrCreateMeta('property', 'og:description').content = metadata.description;
  findOrCreateMeta('name', 'twitter:title').content = metadata.title;
  findOrCreateMeta('name', 'twitter:description').content = metadata.description;
  findOrCreateMeta('property', 'og:url').content = window.location.href;
}
