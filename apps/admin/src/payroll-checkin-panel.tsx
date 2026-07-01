import { Tabs } from '@mantine/core';
import { useSession } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { MyPayslipsPanel } from './my-payslips-panel';
import { CheckInPanel } from './checkin-panel';

export function PayrollCheckinPanel() {
  const { me } = useSession();
  // Mirror the NAV_GATES gate for the standalone 'checkin' section this tab replaces
  // (checkInOut.punch) so a permission revocation hides the tab exactly as it would have
  // hidden the standalone nav item. my-payslips is 'open' — every staff member owns their own.
  const canCheckin = can(me.roles, me.isSuperAdmin, 'checkInOut', 'punch');

  return (
    <Tabs defaultValue="payslips" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="payslips">Phiếu lương</Tabs.Tab>
        {canCheckin && <Tabs.Tab value="checkin">Chấm công</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="payslips" pt="md">
        <MyPayslipsPanel />
      </Tabs.Panel>
      {canCheckin && (
        <Tabs.Panel value="checkin" pt="md">
          <CheckInPanel />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}
