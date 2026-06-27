import { LmsLoginGate, useLmsSession } from '@cmc/ui';
import { StudentShell } from './student-shell';
import { ParentShell } from './parent-shell';

function Router() {
  const { principal } = useLmsSession();
  return principal.kind === 'student' ? (
    <StudentShell principal={principal} />
  ) : (
    <ParentShell principal={principal} />
  );
}

export function App() {
  return (
    <LmsLoginGate>
      <Router />
    </LmsLoginGate>
  );
}
