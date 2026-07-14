import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Linkrowth",
  description:
    "Triage your LinkedIn feed — surface posts that are good to engage before you spend time or tokens.",
  version: "0.1.0",
  icons: {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "Linkrowth",
    default_icon: {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
    },
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  permissions: ["storage", "sidePanel"],
  host_permissions: ["https://www.linkedin.com/*"],
  content_scripts: [
    {
      matches: ["https://www.linkedin.com/*"],
      js: ["src/content/main.ts"],
      css: ["src/content/badge.css"],
      run_at: "document_idle",
    },
  ],
});
