import SphereStage from "@/components/sphere/SphereStage";

/** Phase 1 review page: the sphere alone with the tweak panel. */
export default function SpherePage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <SphereStage debug spin />
    </main>
  );
}
