import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // the hologram maps carry a content hash in their names (scripts/hologram/pack_maps.py): cache them for good;
        // meta.json (fixed name, lists the current maps) keeps the default revalidation
        source: "/hologram/:file([a-z]+\\.[0-9a-f]{8}\\.webp)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
