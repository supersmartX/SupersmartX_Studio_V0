export const SEO_CONFIG = {
  siteName: 'SupersmartX Studio',
  siteUrl: 'https://studio.supersmartx.com',
  defaultTitle: 'SupersmartX Studio — Creator Content Studio',
  defaultDescription:
    'Record once. Publish everywhere. Turn your script into a camera-ready, platform-ready video without learning video editing. No downloads. Private by design.',
  defaultImage: '/brand/studio/exports/social/og-image-1200x630.png',
  organization: {
    name: 'SupersmartX',
    legalName: 'SupersmartX',
    url: 'https://studio.supersmartx.com',
    logo: 'https://studio.supersmartx.com/brand/studio/logo/primary/studio-mark-approved-1024.png',
    description:
      'Creator Content Studio — Record once. Publish everywhere. A browser-based tool for creators, educators and teams.',
    sameAs: [] as string[], // Add verified profiles when available (LinkedIn, GitHub, Product Hunt)
    contactPoint: {
      email: 'support@supersmartx.com',
    },
  },
  defaultRobots: {
    index: true,
    follow: true,
  },
} as const;

export function absoluteUrl(path: string): string {
  return `${SEO_CONFIG.siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
