/* Entry for the standalone online preview: the Phase 1 page without the Next.js shell. */
import { createRoot } from "react-dom/client";
import SphereStage from "@/components/sphere/SphereStage";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <SphereStage debug />
    </main>,
  );
}
