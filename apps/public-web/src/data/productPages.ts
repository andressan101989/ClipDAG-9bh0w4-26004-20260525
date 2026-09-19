export type ProductSection = {
  eyebrow: string;
  title: string;
  body: string;
  image: string;
  imageAlt: string;
  points: string[];
};

export type ProductPageContent = {
  pageTitle: string;
  description: string;
  eyebrow: string;
  headline: string;
  lead: string;
  heroImage: string;
  heroImageMobile: string;
  heroAlt: string;
  heroLabel: string;
  theme: 'social' | 'business' | 'ads' | 'marketplace' | 'creators' | 'live';
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  bridge: { eyebrow: string; title: string; body: string; links: { label: string; href: string }[] };
  sections: ProductSection[];
  closing: { title: string; body: string; cta: { label: string; href: string } };
};

const media = '/media/home';

export const productPages: Record<'features' | 'business' | 'ads' | 'marketplace' | 'creators' | 'live', ProductPageContent> = {
  features: {
    pageTitle: 'Features',
    description: 'Explore how social discovery, creators, LIVE, Marketplace and Business connect in Nelyon.',
    eyebrow: 'The Nelyon ecosystem',
    headline: 'One place to discover what moves you.',
    lead: 'A connected experience for content, people, LIVE and commerce — with tools for the businesses behind it.',
    heroImage: `${media}/feed-1120.webp`, heroImageMobile: `${media}/feed-720.webp`, heroAlt: 'Illustrative Nelyon-style creator feed preview', heroLabel: 'Discover · Create · Connect', theme: 'social',
    primaryCta: { label: 'Explore the experience', href: '#explore' }, secondaryCta: { label: 'Open Nelyon Business', href: '/business/home' },
    bridge: { eyebrow: 'Connected by design', title: 'Not separate apps. One evolving ecosystem.', body: 'A discovery moment can lead to a creator, a LIVE experience or a product. Businesses have a dedicated workspace for their side of that journey, including Ads.', links: [{ label: 'Creators', href: '/creators' }, { label: 'Marketplace', href: '/marketplace' }, { label: 'Business', href: '/business' }, { label: 'Ads', href: '/ads' }] },
    sections: [
      { eyebrow: 'Discover + create', title: 'Content has more than one path.', body: 'Explore the Feed, search, Stories and creator profiles. Share content and make a space for the moments worth following.', image: `${media}/feed-720.webp`, imageAlt: 'Illustrative creator feed artwork', points: ['Feed and discovery', 'Stories and profiles', 'Content publishing'] },
      { eyebrow: 'Participate + explore', title: 'From LIVE energy to a product you love.', body: 'LIVE, Battles and Marketplace bring participation and product discovery into the same Nelyon world.', image: `${media}/live-battle-760.webp`, imageAlt: 'Illustrative split-screen LIVE Battle concept', points: ['LIVE interaction', 'Battle experiences', 'Marketplace discovery'] },
    ],
    closing: { title: 'Find your way into Nelyon.', body: 'Explore the ecosystem, or open the workspace built for businesses.', cta: { label: 'Discover Nelyon Business', href: '/business' } },
  },
  business: {
    pageTitle: 'Nelyon Business',
    description: 'A dedicated workspace for Nelyon products, orders, Ads, media, Analytics, Finance and Team.',
    eyebrow: 'Nelyon Business',
    headline: 'Build your business inside the ecosystem.',
    lead: 'A dedicated, access-controlled workspace for your store, campaigns, operations and insights — connected to Nelyon.',
    heroImage: `${media}/studio-light-760.webp`, heroImageMobile: `${media}/studio-light-440.webp`, heroAlt: 'Illustrative studio product presentation', heroLabel: 'Store · Ads · Analytics', theme: 'business',
    primaryCta: { label: 'Open Nelyon Business', href: '/business/home' }, secondaryCta: { label: 'Sign in', href: '/business/login' },
    bridge: { eyebrow: 'One workspace', title: 'The tools behind the experience.', body: 'Products and orders, media, Ads, Analytics, Finance, payouts and Team live in the private Business workspace. Access follows the permissions granted to each member.', links: [{ label: 'Explore Ads', href: '/ads' }, { label: 'Explore Marketplace', href: '/marketplace' }] },
    sections: [
      { eyebrow: 'Store + operations', title: 'Keep commerce organized.', body: 'Manage your product catalog, variants, inventory and orders in Seller Center, alongside media for your business.', image: `${media}/studio-light-440.webp`, imageAlt: 'Illustrative studio light product render', points: ['Products and inventory', 'Orders and fulfillment', 'Business media'] },
      { eyebrow: 'Insights + access', title: 'See the picture. Work with your team.', body: 'Analytics brings together business performance. Finance and payouts have their own protected views, while Team controls who can access each area.', image: `${media}/feed-720.webp`, imageAlt: 'Illustrative creator feed artwork representing connected commerce', points: ['Analytics overview', 'Finance and payouts', 'Team permissions'] },
    ],
    closing: { title: 'Your business has a home in Nelyon.', body: 'Sign in to the private workspace. Your account and permissions determine what you can access.', cta: { label: 'Open Nelyon Business', href: '/business/home' } },
  },
  ads: {
    pageTitle: 'Nelyon Ads',
    description: 'Discover Nelyon Ads placements across Marketplace and Social Feed, managed from Nelyon Business.',
    eyebrow: 'Nelyon Ads',
    headline: 'Meet people in the moments that matter.',
    lead: 'Create product-focused campaigns for placements inside Nelyon, then manage and review them in the private Business workspace.',
    heroImage: `${media}/feed-1120.webp`, heroImageMobile: `${media}/feed-720.webp`, heroAlt: 'Illustrative feed artwork representing a Nelyon Ads placement', heroLabel: 'Marketplace · Search · Feed', theme: 'ads',
    primaryCta: { label: 'Open Ads Manager', href: '/business/ads' }, secondaryCta: { label: 'Explore Business', href: '/business' },
    bridge: { eyebrow: 'Where campaigns appear', title: 'Placements connected to discovery.', body: 'Campaign placement options include Marketplace home, Marketplace search and Social Feed. Product eligibility and campaign controls stay in Ads Manager.', links: [{ label: 'Marketplace', href: '/marketplace' }, { label: 'Business workspace', href: '/business' }] },
    sections: [
      { eyebrow: 'Marketplace placements', title: 'Show up while people explore.', body: 'Marketplace home and search placements bring eligible products into shopping discovery.', image: `${media}/studio-light-440.webp`, imageAlt: 'Illustrative product render for Marketplace placement', points: ['Marketplace home', 'Marketplace search', 'Product-focused campaigns'] },
      { eyebrow: 'Social Feed', title: 'Commerce can meet content.', body: 'Social Feed placement is part of the existing Nelyon Ads surface. Campaign creation, placement selection and reporting are handled in Business.', image: `${media}/feed-720.webp`, imageAlt: 'Illustrative creator feed artwork representing a Social Feed placement', points: ['Social Feed placement', 'Campaign management', 'Business reporting'] },
    ],
    closing: { title: 'Ads belong to the bigger picture.', body: 'Use the private Ads Manager to work with your campaigns and available reporting.', cta: { label: 'Open Ads Manager', href: '/business/ads' } },
  },
  marketplace: {
    pageTitle: 'Marketplace',
    description: 'Discover products, stores and creator-connected commerce within the Nelyon ecosystem.',
    eyebrow: 'Nelyon Marketplace',
    headline: 'Discover more than a product.',
    lead: 'Explore products in a world already shaped by people, content and creators. Marketplace is part of Nelyon, not a separate destination.',
    heroImage: `${media}/studio-light-760.webp`, heroImageMobile: `${media}/studio-light-440.webp`, heroAlt: 'Illustrative studio light product render', heroLabel: 'Products · Stores · Discovery', theme: 'marketplace',
    primaryCta: { label: 'See how it connects', href: '#explore' }, secondaryCta: { label: 'For businesses', href: '/business' },
    bridge: { eyebrow: 'Social commerce', title: 'Products alongside discovery.', body: 'Browse products and stores while Nelyon connects commerce to Feed, search and creator content where relevant.', links: [{ label: 'Explore creators', href: '/creators' }, { label: 'Business tools', href: '/business' }] },
    sections: [
      { eyebrow: 'Product discovery', title: 'A closer look at what you find.', body: 'Marketplace and product detail views help people explore items and the stores behind them.', image: `${media}/product-440.webp`, imageAlt: 'Illustrative creator microphone product render', points: ['Product presentation', 'Store discovery', 'Search and browsing'] },
      { eyebrow: 'For sellers', title: 'One place to operate the other side.', body: 'Seller Center gives businesses tools for products, inventory and orders, while Marketplace remains connected to the broader Nelyon experience.', image: `${media}/studio-light-440.webp`, imageAlt: 'Illustrative studio light product render', points: ['Catalog and variants', 'Inventory', 'Order operations'] },
    ],
    closing: { title: 'Commerce, in context.', body: 'Learn how businesses manage the products behind the experience.', cta: { label: 'Explore Nelyon Business', href: '/business' } },
  },
  creators: {
    pageTitle: 'Creators',
    description: 'Explore creator profiles, content, community and connected LIVE and commerce experiences on Nelyon.',
    eyebrow: 'Creators on Nelyon',
    headline: 'Make space for your point of view.',
    lead: 'A profile, content and community can move with you across discovery, LIVE and product moments in Nelyon.',
    heroImage: `${media}/feed-1120.webp`, heroImageMobile: `${media}/feed-720.webp`, heroAlt: 'Illustrative fictional creator scene', heroLabel: 'Create · Share · Connect', theme: 'creators',
    primaryCta: { label: 'Explore creator tools', href: '#explore' }, secondaryCta: { label: 'Discover LIVE', href: '/live' },
    bridge: { eyebrow: 'Creator identity', title: 'Your presence travels across formats.', body: 'Profiles, published content and community interaction give creators a consistent presence throughout Nelyon.', links: [{ label: 'Explore features', href: '/features' }, { label: 'Discover LIVE', href: '/live' }] },
    sections: [
      { eyebrow: 'Content + profile', title: 'Show what makes your perspective yours.', body: 'Publish content, shape your profile and help people discover your work through Feed and search.', image: `${media}/feed-720.webp`, imageAlt: 'Illustrative fictional creator artwork', points: ['Content publishing', 'Creator profile', 'Feed and search'] },
      { eyebrow: 'Connected moments', title: 'The conversation does not end at a post.', body: 'Creators can take part in LIVE experiences and connect content to products where the experience supports it.', image: `${media}/live-battle-760.webp`, imageAlt: 'Illustrative LIVE creator scene', points: ['LIVE participation', 'Community interaction', 'Creator commerce surfaces'] },
    ],
    closing: { title: 'Keep creating. Keep connecting.', body: 'Discover the different ways creators can be part of the Nelyon ecosystem.', cta: { label: 'Explore all features', href: '/features' } },
  },
  live: {
    pageTitle: 'LIVE',
    description: 'Explore Nelyon LIVE experiences, real-time interaction and creator Battles.',
    eyebrow: 'Nelyon LIVE',
    headline: 'A moment feels different when you are there.',
    lead: 'Join real-time creator experiences, participate with reactions and see how Battles bring two LIVE worlds together.',
    heroImage: `${media}/live-battle-1420.webp`, heroImageMobile: `${media}/live-battle-760.webp`, heroAlt: 'Illustrative split-screen LIVE Battle with fictional participants', heroLabel: 'LIVE · Reactions · Battles', theme: 'live',
    primaryCta: { label: 'Explore LIVE', href: '#explore' }, secondaryCta: { label: 'Meet creators', href: '/creators' },
    bridge: { eyebrow: 'Real-time connection', title: 'Watch, respond, be part of it.', body: 'LIVE brings hosts and viewers into the same moment. Battle interfaces add a shared stage with two sides and a live score.', links: [{ label: 'Creators', href: '/creators' }, { label: 'All features', href: '/features' }] },
    sections: [
      { eyebrow: 'LIVE interaction', title: 'Closer to the moment.', body: 'Host and viewer experiences include real-time participation and reactions. The experience remains part of Nelyon’s wider creator world.', image: `${media}/feed-720.webp`, imageAlt: 'Illustrative fictional creator media', points: ['Host and viewer surfaces', 'Live reactions', 'Creator connection'] },
      { eyebrow: 'Battles', title: 'Two sides. One shared stage.', body: 'Battle views bring creators together around a timer, score and audience activity. The artwork shown here is an illustrative preview, not a real broadcast.', image: `${media}/live-battle-760.webp`, imageAlt: 'Illustrative split-screen LIVE Battle preview', points: ['Two-sided stage', 'Score and timer', 'Audience participation'] },
    ],
    closing: { title: 'There is more to discover live.', body: 'Explore the creators and content that make real-time moments worth sharing.', cta: { label: 'Meet Nelyon creators', href: '/creators' } },
  },
};

export const productPageSlugs = Object.keys(productPages);
