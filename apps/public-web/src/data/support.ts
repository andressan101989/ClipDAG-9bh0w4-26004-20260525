// Factual, static guidance. CTA keys resolve through the existing publicCtas authority.
export type SupportLink = { label: string; cta: 'features' | 'business' | 'ads' | 'marketplace' | 'creators' | 'live' | 'download' | 'privacy' | 'terms' | 'contact' };
export type SupportTopic = { id: string; title: string; introduction: string; questions: { question: string; answer: string }[]; links: SupportLink[] };

export const supportTopics: readonly SupportTopic[] = [
  { id: 'account', title: 'Account & profile', introduction: 'Find the account controls currently available in the app.', questions: [
    { question: 'Does the account-deletion option delete my account?', answer: 'No. The current settings screens only show information. They do not delete an account or submit a deletion request. Official contact options will appear on the Contact page when verified.' },
  ], links: [{ label: 'Contact information', cta: 'contact' }] },
  { id: 'content', title: 'Content & Stories', introduction: 'Explore publishing and discovery in Nelyon.', questions: [
    { question: 'Where can I learn about content and discovery?', answer: 'The Features page introduces the feed, Stories and discovery surfaces. It is an overview, not a replacement for in-app controls.' },
  ], links: [{ label: 'Explore features', cta: 'features' }] },
  { id: 'live', title: 'LIVE & Battles', introduction: 'Understand the LIVE experience at a glance.', questions: [
    { question: 'Where can I learn about LIVE?', answer: 'The LIVE page describes the supported host, viewer and Battle experience without promising that every feature is available to every account.' },
  ], links: [{ label: 'Explore LIVE', cta: 'live' }] },
  { id: 'marketplace', title: 'Marketplace', introduction: 'Learn how commerce fits into the ecosystem.', questions: [
    { question: 'Where can I learn about products and orders?', answer: 'The Marketplace page explains discovery and commerce. Order-specific actions remain inside the relevant authenticated experience.' },
  ], links: [{ label: 'Explore Marketplace', cta: 'marketplace' }] },
  { id: 'business', title: 'Nelyon Business & Ads', introduction: 'Locate the public overview and the private workspace.', questions: [
    { question: 'How do I open Nelyon Business?', answer: 'Start from the public Business page and choose Open Nelyon Business. The private workspace handles sign-in and access.' },
    { question: 'Where can I learn about advertising?', answer: 'The public Ads page explains campaigns and placements; campaign data remains in the private workspace.' },
  ], links: [{ label: 'About Nelyon Business', cta: 'business' }, { label: 'About Nelyon Ads', cta: 'ads' }] },
  { id: 'availability', title: 'App availability', introduction: 'Use only verified destinations.', questions: [
    { question: 'Where are the official app links?', answer: 'The Download page shows the current availability state. It does not link to an unverified app listing.' },
  ], links: [{ label: 'View download availability', cta: 'download' }] },
  { id: 'privacy', title: 'Privacy & legal', introduction: 'Read publication status without assuming a draft is effective.', questions: [
    { question: 'Where can I read Privacy and Terms?', answer: 'The public Privacy and Terms pages show their current publication status. A document awaiting approval is not presented as a current policy.' },
  ], links: [{ label: 'Privacy page', cta: 'privacy' }, { label: 'Terms page', cta: 'terms' }] },
];
