import { LmsLoginGate, useLmsSession } from '@cmc/ui';
import { StudentShell } from './student-shell';
import { ParentShell } from './parent-shell';
import { ShowcaseView } from './showcase-view';

function Router() {
  const { principal } = useLmsSession();
  return principal.kind === 'student' ? (
    <StudentShell principal={principal} />
  ) : (
    <ParentShell principal={principal} />
  );
}

export function App() {
  const isShowcase = window.location.pathname.endsWith('/showcase') || window.location.hash === '#showcase';
  if (isShowcase) {
    return <ShowcaseView />;
  }

  return (
    <LmsLoginGate>
      <Router />
    </LmsLoginGate>
  );
}

