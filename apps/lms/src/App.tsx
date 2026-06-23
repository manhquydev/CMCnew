import { LmsLoginGate, useLmsSession } from '@cmc/ui';
import { StudentView } from './student-view';
import { ParentView } from './parent-view';

function Router() {
  const { principal } = useLmsSession();
  return principal.kind === 'student' ? (
    <StudentView principal={principal} />
  ) : (
    <ParentView principal={principal} />
  );
}

export function App() {
  return (
    <LmsLoginGate>
      <Router />
    </LmsLoginGate>
  );
}
