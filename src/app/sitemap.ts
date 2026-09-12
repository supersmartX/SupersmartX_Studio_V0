import type { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SEO_CONFIG.siteUrl;
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${base}/legal/privacy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${base}/legal/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];
}
