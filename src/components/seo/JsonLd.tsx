type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function JsonLd({ data }: JsonLdProps) {
  const json = Array.isArray(data) ? data : [data];
  return (
    <>
      {json.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
    </>
  );
}

import { SEO_CONFIG } from '@/lib/seo/config';

export function organizationSchema() {
  const { organization } = SEO_CONFIG;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: organization.name,
    url: organization.url,
    logo: organization.logo,
    description: organization.description,
    email: organization.contactPoint.email,
    sameAs: organization.sameAs,
  };
}

export function websiteSchema() {
  const { siteUrl, siteName } = SEO_CONFIG;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
    publisher: { '@type': 'Organization', name: siteName },
  };
}

export function softwareApplicationSchema() {
  const { siteUrl } = SEO_CONFIG;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SupersmartX Studio',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url: siteUrl,
    description:
      'Creator Content Studio — Record once. Publish everywhere. Turn your script into a camera-ready, platform-ready video without learning video editing.',
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'USD',
        url: `${siteUrl}/#pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Creator',
        price: '7.99',
        priceCurrency: 'USD',
        url: `${siteUrl}/#pricing`,
      },
    ],
    featureList: [
      'Built-in teleprompter with voice-activated scrolling',
      'Unlimited video recording for Creator, 10 minutes per day for Free',
      '1080p export for Creator, 720p for Free',
      'Platform presets for YouTube, Instagram, TikTok, LinkedIn',
      'Preview video on any platform before exporting',
      'Cloud video library for Creator',
    ],
  };
}
