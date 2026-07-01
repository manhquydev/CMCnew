import { Tabs } from '@mantine/core';
import { useSession } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { Workspace, type NavAction } from './class-workspace';
import { CoursesPanel } from './courses-panel';
import { AssessmentPanel } from './assessment-panel';

export function StudentManagementPanel({ navAction }: { navAction: NavAction | null }) {
  const { me } = useSession();
  // Mirror the same gates NAV_GATES used for the standalone sections these tabs replace
  // (classes/courses: open; assessment: assessment.termList) so a permission revocation hides
  // the tab here exactly as it would have hidden the standalone nav item.
  const canAssessment = can(me.roles, me.isSuperAdmin, 'assessment', 'termList');

  return (
    <Tabs defaultValue="classes" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="classes">Lớp học</Tabs.Tab>
        <Tabs.Tab value="courses">Khóa học</Tabs.Tab>
        {canAssessment && <Tabs.Tab value="assessment">Học bạ</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="classes" pt="md">
        <Workspace navAction={navAction} />
      </Tabs.Panel>
      <Tabs.Panel value="courses" pt="md">
        <CoursesPanel />
      </Tabs.Panel>
      {canAssessment && (
        <Tabs.Panel value="assessment" pt="md">
          <AssessmentPanel />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}
