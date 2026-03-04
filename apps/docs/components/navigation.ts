export type NavItem = {
  title: string;
  href: string;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    label: "Get started",
    items: [{ title: "Getting Started", href: "/guides/getting-started" }],
  },
  {
    label: "Development",
    items: [
      { title: "Deployment", href: "/guides/deployment" },
      { title: "Env & Config", href: "/guides/env-config" },
      { title: "Docker (API)", href: "/guides/docker" },
      { title: "API Architecture", href: "/guides/api-architecture" },
      { title: "Database", href: "/guides/database" },
      { title: "Testing", href: "/guides/testing" },
    ],
  },
  {
    label: "Contributing",
    items: [{ title: "Contributing", href: "/guides/contributing" }],
  },
];
