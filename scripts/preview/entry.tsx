/* Entry for the standalone online preview: the full site without the Next.js shell. */
import { createRoot } from "react-dom/client";
import Site from "@/components/site/Site";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Site />);
