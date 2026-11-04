import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RentFlow",
    short_name: "RentFlow",
    description: "Rent collection for PGs and hostels, on WhatsApp.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0F766E",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
