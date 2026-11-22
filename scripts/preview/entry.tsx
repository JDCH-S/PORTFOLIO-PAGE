/* Entry for the standalone online preview: the full site without the Next.js shell. */
import { createRoot } from "react-dom/client";
import Site from "@/components/site/Site";
import Diag, { installDiagHooks } from "./Diag";

// a diagnostics readout for devices we cannot run here (iOS): PREVIEW_DIAG=1 node scripts/preview/build.mjs
const DIAG = process.env.PREVIEW_DIAG === "1";
if (DIAG) installDiagHooks();

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <>
      <Site />
      {DIAG ? <Diag /> : null}
    </>,
  );
