import { lazy, Suspense } from 'react';
import { LmsLoginGate, useLmsSession } from '@cmc/ui';
import { StudentShell } from './student-shell';
import { ParentShell } from './parent-shell';

const ShowcaseView = import.meta.env.DEV
  ? lazy(() => import('./showcase-view').then((m) => ({ default: m.ShowcaseView })))
  : null;

function Router() {
  const { principal } = useLmsSession();
  return principal.kind === 'student' ? (
    <StudentShell principal={principal} />
  ) : (
    <ParentShell principal={principal} />
  );
}

export function App() {
  if (import.meta.env.DEV) {
    const isShowcase = window.location.pathname.endsWith('/showcase') || window.location.hash === '#showcase';
    if (isShowcase && ShowcaseView) {
      return (
        <Suspense fallback={null}>
          <ShowcaseView />
        </Suspense>
      );
    }
  }

  return (
    <LmsLoginGate>
      <Router />
    </LmsLoginGate>
  );
}

