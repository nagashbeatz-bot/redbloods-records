/**
 * Sunny OPERATIONS source — the typed shape (pure, no runtime imports). Filled by lib/partner/operations/readers.ts.
 * Narrow by design: statuses, dates, ids and amounts only — never free text, file paths, links or secrets.
 */
export interface Section<T> { rows: T[]; capped: boolean }
export type Maybe<T> = Section<T> | null;

export interface OpsRedFilmsProduction {
  id: string; title: string; productionType: string | null; status: string | null; projectId: string | null; clientId: string | null;
  artistName: string | null; clientSource: string | null; shootDate: string | null; publishDate: string | null; editStatus: string | null;
  collectionStatus: string | null; generalBudget: number | null; clientPrice: number | null; advanceRequired: number | null; advanceReceived: number | null;
}
export interface OpsBudgetItem { productionId: string; planned: number | null; actual: number | null; status: string | null; hasTransaction: boolean }
export interface OpsBudgetPayment { productionId: string; amount: number | null; paymentDate: string | null }
export interface OpsClipItem { projectId: string | null; category: string | null; amount: number | null; currency: string | null; status: string | null; hasTransaction: boolean }
export interface OpsMeeting { id: string; date: string | null; time: string | null; status: string | null; projectId: string | null; clientId: string | null; hasCalendarEvent: boolean }
export interface OpsProjectAction { id: string; projectId: string | null; actionType: string | null; contentType: string | null; recipientRole: string | null; status: string | null; actionDate: string | null; followupDate: string | null }
export interface OpsBeat { id: string; name: string; genre: string | null; musicalKey: string | null; status: string | null; createdAt: string | null }
export interface OpsBeatAssignment { beatId: string; artistSlug: string }
export interface OpsCampaign { id: string; projectId: string | null; title: string; artistName: string | null; releaseDate: string | null; status: string | null; promotionBudget: number | null }
export interface OpsContentItem { campaignId: string | null; status: string | null; contentType: string | null; platform: string | null; dueDate: string | null; publishDate: string | null }
export interface OpsPromotion { campaignId: string | null; channel: string | null; plannedAmount: number | null; status: string | null; promoDate: string | null; hasTransaction: boolean }
export interface OpsBalanceCycle { artistId: string; cycleIndex: number; startDate: string | null; endDate: string | null; income: number | null; payments: number | null; expenses: number | null; endingBalance: number | null; closedAt: string | null }
export interface OpsAlbumTrack { projectId: string | null; trackNumber: number | null; title: string; status: string | null; mixStatus: string | null; masterStatus: string | null }
export interface OpsEngineerWork {
  id: string; projectId: string | null; engineerName: string; workType: string | null; workTitle: string | null; status: string | null; sentDate: string | null;
  internalDeadline: string | null; agreedPrice: number | null; amountPaid: number | null; currency: string | null; paymentDate: string | null;
}
export interface OpsMixVersion { id: string; workId: string | null; status: string | null; createdAt: string | null }
export interface OpsMixComment { versionId: string | null; status: string | null }
export interface OpsFinalFile { workId: string | null; createdAt: string | null }
export interface OpsDelivery { projectId: string; status: string | null; deliveredAt: string | null }
export interface OpsEquipment { category: string | null; status: string | null }
/** Project metadata the company-state reader drops (incl. HIDDEN projects). No notes / files / folder paths / links. */
export interface OpsProjectMeta {
  id: string; name: string; status: string | null; projectType: string | null; businessType: string | null; artistText: string | null;
  deadline: string | null; startDate: string | null; endDate: string | null; parentProject: string | null; isHidden: boolean;
  plannedHours: number | null; plannedDays: number | null; updatedAt: string | null;
}

/** A Redbloods record that STORES a Google Calendar event id (the only canonical calendar relationships). */
export interface OpsCalendarLink { eventId: string; kind: "SESSION" | "MEETING" | "SHOW" | "SOCIAL_CONTENT"; entityId: string; projectId: string | null; clientId: string | null; showId: string | null; date: string | null; status: string | null }

export interface OperationsRaw {
  redFilms: Maybe<OpsRedFilmsProduction>;
  budgetItems: Maybe<OpsBudgetItem>;
  budgetPayments: Maybe<OpsBudgetPayment>;
  equipment: Maybe<OpsEquipment>;
  clipItems: Maybe<OpsClipItem>;
  meetings: Maybe<OpsMeeting>;
  projectActions: Maybe<OpsProjectAction>;
  beats: Maybe<OpsBeat>;
  beatAssignments: Maybe<OpsBeatAssignment>;
  campaigns: Maybe<OpsCampaign>;
  contentItems: Maybe<OpsContentItem>;
  promotions: Maybe<OpsPromotion>;
  balanceCycles: Maybe<OpsBalanceCycle>;
  albumTracks: Maybe<OpsAlbumTrack>;
  engineerWork: Maybe<OpsEngineerWork>;
  mixVersions: Maybe<OpsMixVersion>;
  mixComments: Maybe<OpsMixComment>;
  finalFiles: Maybe<OpsFinalFile>;
  deliveries: Maybe<OpsDelivery>;
  projectsMeta: Maybe<OpsProjectMeta>;
  /** Records that store a Google Calendar event id (sessions / meetings / shows / social content). Optional for older fixtures. */
  calendarLinks?: Maybe<OpsCalendarLink>;
  /** Whether the integration's stored credential KEY exists (the value is never selected). null = could not tell. */
  integrations: { googleCalendarConnected: boolean | null; dropboxConnected: boolean | null };
}
