import type { TeleprompterSettings, AspectRatio, PlatformId, PlatformPreset } from '@/types';

export const ASPECT_RATIO_PRESETS: Record<AspectRatio, { label: string; icon: string; width: number; height: number; cssClass: string }> = {
  '16:9': { label: 'Landscape', icon: '🖥️', width: 1920, height: 1080, cssClass: 'aspect-video' },
  '9:16': { label: 'Portrait', icon: '📱', width: 1080, height: 1920, cssClass: 'aspect-[9/16]' },
  '4:3':  { label: 'Standard', icon: '📺', width: 1440, height: 1080, cssClass: 'aspect-[4/3]' },
  '1:1':  { label: 'Square', icon: '⬜', width: 1080, height: 1080, cssClass: 'aspect-square' },
  '4:5':  { label: 'Portrait', icon: '📱', width: 1080, height: 1350, cssClass: 'aspect-[4/5]' },
};

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'youtube-landscape', label: 'YouTube Landscape', sublabel: '16:9 — 1920×1080', icon: '📺', aspectRatio: '16:9', width: 1920, height: 1080 },
  { id: 'youtube-shorts',    label: 'YouTube Shorts',    sublabel: '9:16 — 1080×1920', icon: '📱', aspectRatio: '9:16', width: 1080, height: 1920 },
  { id: 'instagram-reels',   label: 'Instagram Reels',   sublabel: '9:16 — 1080×1920', icon: '📱', aspectRatio: '9:16', width: 1080, height: 1920 },
  { id: 'tiktok',            label: 'TikTok',            sublabel: '9:16 — 1080×1920', icon: '📱', aspectRatio: '9:16', width: 1080, height: 1920 },
  { id: 'instagram-post',    label: 'Instagram Post',    sublabel: '1:1 — 1080×1080', icon: '⬜', aspectRatio: '1:1', width: 1080, height: 1080 },
  { id: 'instagram-portrait',label: 'Instagram Portrait', sublabel: '4:5 — 1080×1350', icon: '📱', aspectRatio: '4:5', width: 1080, height: 1350 },
  { id: 'linkedin',          label: 'LinkedIn Video',    sublabel: '16:9 — 1920×1080', icon: '🖥️', aspectRatio: '16:9', width: 1920, height: 1080 },
  { id: 'custom',            label: 'Custom',            sublabel: 'Define your own',   icon: '⚙️', aspectRatio: '16:9', width: 1920, height: 1080 },
];

export const DEFAULT_PLATFORM_ID: PlatformId = 'youtube-landscape';

export const DEFAULT_SETTINGS: TeleprompterSettings = {
  fontFamily: "'Inter', sans-serif",
  fontSize: 36,
  scrollSpeed: 30,
  scrollSpeedMultiplier: 1.0,
  areaWidth: 448,
  areaHeight: 80,
  textStartPosition: 15,
  textAlignment: 'center',
  textColor: '#FFFFFF',
};

export const NUDGE_AMOUNT_BUTTON = 50;
export const NUDGE_AMOUNT_KEYBOARD = 40;

export const FONT_FAMILIES = [
  {
    group: 'Gaming & High-Energy Streaming',
    options: [
      { value: 'Impact, sans-serif', label: 'Streamer HUD (Impact)' },
      { value: "'Trebuchet MS', sans-serif", label: 'Live Chat Glance (Trebuchet MS)' },
    ],
  },
  {
    group: 'Aesthetic Vlogs & Storytelling',
    options: [
      { value: 'Georgia, serif', label: 'Calm & Grounded Tone (Georgia)' },
      { value: "Palatino, 'Palatino Linotype', serif", label: 'Premium Documentary (Palatino)' },
    ],
  },
  {
    group: 'Tech, Corporate & Education',
    options: [
      { value: "'Inter', sans-serif", label: 'Minimalist Workspace (Inter)' },
      { value: "'Open Sans', sans-serif", label: 'Clean Presentation (Open Sans)' },
    ],
  },
  {
    group: 'Fast Social Shorts & News',
    options: [
      { value: 'Arial, sans-serif', label: 'Anti-Mistake Bold (Arial)' },
      { value: 'Verdana, sans-serif', label: 'Anti-Blur Spacing (Verdana)' },
    ],
  },
  {
    group: 'Hollywood Set & Creative Script',
    options: [
      { value: "'Courier New', Courier, monospace", label: 'Classic Screenplay (Courier New)' },
      { value: 'Consolas, monospace', label: 'Sleek Developer Matrix (Consolas)' },
    ],
  },
];

export const INSPIRATION_OPTIONS = [
  { key: 'creator', label: 'Creator' },
  { key: 'developer', label: 'Developer' },
  { key: 'student', label: 'Student' },
  { key: 'corporate', label: 'Corporate' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'interview', label: 'Interview' },
  { key: 'sales', label: 'Sales' },
  { key: 'teacher', label: 'Teacher' },
  { key: 'podcast', label: 'Podcast' },
  { key: 'youtube', label: 'YouTube' },
];

export const INSPIRATION_SCRIPTS: Record<string, string> = {
  creator:
    "Hey everyone, and welcome back to the channel! Today we're diving into something I've been asked about constantly: my creative process.\n\nWhether you're a seasoned creator or just starting out, finding your workflow is arguably the most critical step in producing consistent content. Over the past few years, I've tried everything from rigid daily schedules to completely unstructured creative bursts, and honestly, neither extreme worked for me.\n\nWhat I've found instead is a hybrid approach that allows for both discipline and spontaneity.\n\nIn this video, I'll walk you through my three-step framework: brainstorming, drafting, and refining.\n\nI'll show you exactly how I capture fleeting ideas before they disappear, how I structure my outlines so that the editing process becomes a breeze, and why taking a step back before the final polish is absolutely essential for quality control. We'll also cover the specific tools and software I use daily to keep everything organized.\n\nSo grab a cup of coffee, settle in, and let's get into the nitty-gritty of making things online. Don't forget to like and subscribe if you find this helpful!",
  developer:
    "Hello team. Welcome to this week's technical deep dive. Today, we're going to examine the recent architecture migration from our monolithic backend to a microservices-based approach using Docker and Kubernetes.\n\nAs you all know, our previous setup was becoming increasingly difficult to scale, and deployment times were bottlenecking our release cycles. By breaking down the application into smaller, independent services, we aim to improve both reliability and developer velocity.\n\nI'll start by outlining the new container orchestration strategy.\n\nWe've implemented a robust CI/CD pipeline that automatically builds and tests each service in isolation. This means that a bug in the payment gateway won't take down the entire user dashboard. I'll also walk through the updated API gateway routing and how we're handling authentication across these distributed services using JWTs.\n\nFurthermore, we'll discuss the new observability stack—specifically how Prometheus and Grafana are configured to monitor service health and alert us to anomalies before they impact the end user. Please hold your questions until the end of the presentation, and I'll make sure to address all technical concerns. Let's dive into the code.",
  student:
    "Good morning, everyone. Today I'll be presenting my final research project on the impact of renewable energy subsidies on local economies in rural areas.\n\nWhen we talk about the transition to green energy, the conversation often centers on environmental benefits and national policy. However, the localized economic effects are frequently overlooked.\n\nOver the course of the semester, I analyzed data from three different counties that recently implemented substantial solar and wind subsidies, comparing their economic indicators against counties that did not.\n\nMy findings suggest a fascinating dual effect. In the short term, these subsidies lead to a significant spike in local employment, primarily driven by construction and installation jobs. This influx of capital revitalizes local businesses and boosts municipal tax revenues.\n\nHowever, the long-term data paints a more complex picture. Once the initial construction phase is over, the permanent job creation is relatively low, leading to a mild economic contraction if the municipality hasn't actively diversified its investments. Ultimately, while renewable energy subsidies are a powerful catalyst for rural economic development, they must be paired with comprehensive long-term economic planning to ensure sustainable growth. Thank you for your time.",
  corporate:
    "Good afternoon, team. Thank you all for joining this Q3 all-hands meeting.\n\nAs we review our performance over the past quarter, I want to start by acknowledging the tremendous effort everyone has put into navigating what has undeniably been a challenging market environment. Despite the macroeconomic headwinds and increased competition in our primary sector, we have managed to maintain our market share and even expand our footprint in two emerging regions. This is a testament to the resilience and dedication of our entire workforce.\n\nLooking ahead to Q4, our strategic priorities are shifting slightly to focus heavily on operational efficiency and customer retention.\n\nWe'll be rolling out a new cross-functional initiative aimed at streamlining our internal communication and reducing turnaround times for client deliverables. Additionally, we are increasing our investment in our customer success teams to ensure that our highest-value clients receive the dedicated support they need during this critical period.\n\nI encourage all department heads to review the detailed quarterly reports distributed earlier today and begin aligning your team's objectives with these new priorities. Let's finish the year strong and set ourselves up for a highly successful first quarter next year.",
  presentation:
    "Welcome, ladies and gentlemen. Thank you for taking the time out of your busy schedules to be here. Today, I am thrilled to introduce a product that has been years in the making—a solution born out of a simple, yet profound realization about how we interact with our digital environments.\n\nFor too long, we have adapted our workflows to the limitations of our software. We've accepted clunky interfaces, fragmented communication channels, and inefficient processes as just \"the way things are.\"\n\nWhat we are launching today is fundamentally different. We have designed a platform that adapts to you, rather than forcing you to adapt to it. By leveraging advanced machine learning algorithms and a deeply intuitive user interface, this platform anticipates your needs, organizes your data seamlessly, and connects your team in ways previously thought impossible.\n\nDuring this presentation, I'll walk you through a live demonstration of the core features, showing you exactly how much time and frustration this tool can save your organization on a daily basis. We believe this represents a paradigm shift in workplace productivity, and I am incredibly excited to share it with you all today. Let's begin the demo.",
  interview:
    "Thank you for bringing me in today. To give you a brief overview of my background, I've spent the last six years specializing in strategic marketing within the B2B tech sector.\n\nIn my previous role as Senior Marketing Manager, I was responsible for overseeing end-to-end campaign execution, from initial market research and audience segmentation to final performance analysis and ROI reporting. One of my proudest achievements there was spearheading a multi-channel demand generation campaign that ultimately increased our qualified lead pipeline by 45% within a single fiscal year.\n\nWhat truly drives me is the intersection of data and creativity. I believe that the most effective marketing strategies are those grounded in rigorous analytics but brought to life through compelling storytelling and innovative design. I thrive in collaborative environments where cross-functional teams work closely together to align product development with market needs.\n\nWhen I look at the trajectory of your company and the innovative products you are bringing to market, I see a tremendous opportunity to apply my expertise in scaling marketing operations and driving sustainable growth. I'm highly adaptable, deeply analytical, and I'm very excited about the possibility of contributing to your team's continued success.",
  sales:
    "Hi there! Thanks for taking the time to speak with me today. I know your schedule is incredibly packed, so I'll keep this brief and focused on how we can drive tangible value for your organization.\n\nIn speaking with other executives in your industry, a consistent pain point we hear is the challenge of managing customer data across disparate systems, leading to inefficiencies and missed revenue opportunities. Our platform is specifically engineered to solve that exact problem by providing a centralized, intelligent hub for all customer interactions.\n\nUnlike traditional CRMs that simply store data, our solution actively analyzes customer behavior, providing predictive insights that empower your sales and support teams to act proactively.\n\nImagine if your team knew exactly when a client was most likely to upgrade, or when a customer was at risk of churning, before it ever happened. We've seen clients in similar verticals reduce their customer churn by up to 20% within the first six months of implementation, while simultaneously increasing cross-sell revenue.\n\nI'd love to schedule a deeper dive next week to show you a tailored demonstration of the platform and discuss how we can align our solution with your specific growth targets for the upcoming quarter.",
  teacher:
    "Good morning, class! Settle down, please, and let's get started.\n\nToday we are beginning a brand new unit on the Industrial Revolution, a period of profound transformation that forever changed the way humanity lives and works. Up until this point in history, the vast majority of people lived in rural, agrarian societies, producing goods by hand and relying on human or animal power.\n\nOver the next few weeks, we are going to explore how the introduction of mechanization, steam power, and eventually electricity completely upended that traditional way of life.\n\nWe won't just be memorizing dates and inventions, though those are important. We'll be examining the social and economic consequences of these rapid technological advancements. We'll look at the rise of the factory system, the brutal realities of early child labor, the massive urbanization that led to overcrowded cities, and the eventual birth of the modern labor movement.\n\nWe'll read primary source documents from factory workers and industrial magnates alike to understand the conflicting perspectives of the era. By the end of this unit, you'll understand why the Industrial Revolution is considered a major turning point in human history and how its effects are still shaping our world today. Open your textbooks to chapter four.",
  podcast:
    "Welcome back to another episode of 'Deep Dive Dialogues.' I'm your host, and today we have a truly fascinating conversation lined up for you.\n\nWe are living in an era of unprecedented technological acceleration, where concepts that were considered pure science fiction a decade ago are rapidly becoming our everyday reality. From artificial intelligence and quantum computing to breakthroughs in biotechnology, the pace of change can feel overwhelmingly fast.\n\nIn this episode, we're joined by Dr. Elena Rostova, a leading ethicist and futurist who has spent her career studying the societal implications of emerging technologies.\n\nWe're going to tackle the big questions: How do we ensure that these powerful new tools are used to benefit humanity as a whole, rather than exacerbating existing inequalities? What frameworks do we need to put in place to govern artificial general intelligence? And perhaps most importantly, how do we maintain our fundamental sense of humanity in a world increasingly mediated by algorithms?\n\nIt's a complex, challenging, and incredibly important conversation that touches on philosophy, economics, and public policy. So, whether you're listening on your commute or while working out, get ready for a deep and thought-provoking discussion. Let's get right into it.",
  youtube:
    "What's up guys! Welcome back to the channel. Today's video is one I've been incredibly excited to film.\n\nFor the last 30 days, I challenged myself to completely overhaul my morning routine. If you've followed my content for a while, you know I've always struggled with productivity in the early hours. I was the classic 'snooze button' abuser, usually waking up rushed, stressed, and already feeling behind on the day. I realized that if I wanted to reach the next level in my business and my personal life, something fundamental had to change.\n\nSo, I did a ton of research, read all the classic productivity books, and pieced together what I believed would be the ultimate, high-performance morning protocol.\n\nWe're talking waking up at 5 AM, cold plunges, meditation, journaling, and dedicated deep work blocks before the rest of the world is even awake. In this video, I'm taking you along for the entire journey.\n\nI'll share the honest, unfiltered truth about how difficult the first few days were, the surprising benefits I started noticing around week two, and the specific habits that actually made a massive difference versus the ones that were just hype. Make sure you watch until the end, because the results completely blew my mind. Let's get into the video!",
};
