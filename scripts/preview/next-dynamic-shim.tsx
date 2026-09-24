/* Minimal stand-in for next/dynamic when the sphere is bundled outside Next.js (online preview). */
import { Suspense, lazy, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

export default function dynamic<P extends object>(loader: Loader<P>, opts?: { ssr?: boolean; loading?: ComponentType }) {
  const Lazy = lazy(loader);
  const Loading = opts?.loading;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
