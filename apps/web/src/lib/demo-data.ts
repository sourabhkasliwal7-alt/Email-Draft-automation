/**
 * The demo records that supabase/seed.sql puts in a fresh database. They are recognised here so Setup can mark them "Demo" and
 * offer one button that archives (soft-deletes) exactly these and nothing else. Nothing is ever hard-deleted.
 */
const P = "00000000-0000-4000-8000-0000000000";

export const DEMO_OFFER_IDS: readonly string[] = [`${P}a1`, `${P}a2`];
export const DEMO_CASE_STUDY_IDS: readonly string[] = [`${P}b1`, `${P}b2`];
export const DEMO_INBOX_ID = `${P}c1`;
export const DEMO_INBOX_EMAIL = "demo-sender@example.com";
export const DEMO_CAMPAIGN_ID = `${P}d1`;
export const DEMO_CAMPAIGN_NAME = "Demo campaign";

export const isDemoOffer = (o: { id: string }): boolean => DEMO_OFFER_IDS.includes(o.id);
export const isDemoCaseStudy = (c: { id: string }): boolean => DEMO_CASE_STUDY_IDS.includes(c.id);
export const isDemoInbox = (i: { id: string; email: string }): boolean => i.id === DEMO_INBOX_ID || i.email.trim().toLowerCase() === DEMO_INBOX_EMAIL;
export const isDemoCampaign = (c: { id: string; name: string }): boolean => c.id === DEMO_CAMPAIGN_ID || c.name.trim() === DEMO_CAMPAIGN_NAME;

/** True when any demo record is still around (the Archive demo data button only shows then). */
export function hasDemoData(x: { offers?: { id: string }[]; inboxes?: { id: string; email: string }[]; campaigns?: { id: string; name: string }[] }): boolean {
  return Boolean(x.offers?.some(isDemoOffer) || x.inboxes?.some(isDemoInbox) || x.campaigns?.some(isDemoCampaign));
}
