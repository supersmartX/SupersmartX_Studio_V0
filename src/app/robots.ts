import type { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/studio', '/api/', '/auth/'],
      },
    ],
    sitemap: `${SEO_CONFIG.siteUrl}/sitemap.xml`,
  };
}
