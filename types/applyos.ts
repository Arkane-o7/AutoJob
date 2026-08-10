export type ApplicationStatus =
  | "saved"
  | "preparing"
  | "applied"
  | "follow_up_due"
  | "interview"
  | "assignment"
  | "offer"
  | "rejected"
  | "closed";

export type Priority = "low" | "medium" | "high";

export type ContactRelationship = "recruiter" | "hiring_manager" | "interviewer" | "employee" | "referral" | "other";
export type InterviewType = "recruiter_screen" | "hiring_manager" | "technical" | "behavioral" | "panel" | "final" | "other";
export type InterviewFormat = "video" | "phone" | "onsite" | "other";
export type ActionKind = "application_follow_up" | "application_final_follow_up" | "contact_follow_up" | "interview_prep" | "interview_thank_you" | "custom";
export type ActionStatus = "open" | "done" | "skipped" | "cancelled";
export type CalendarSyncStatus = "not_synced" | "syncing" | "synced" | "error" | "disconnected";
export type ActionChannel = "email" | "linkedin" | "phone" | "meeting" | "other";
export type ContactActivityType = "email" | "linkedin" | "phone" | "meeting" | "note";
export type ContactActivityDirection = "outbound" | "inbound" | "none";
export type WaitingKind = "recruiter_reply" | "referral_response" | "interview_feedback" | "scheduling" | "assignment_review" | "offer_documents" | "other";

export type ATSPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "icims"
  | "oracle"
  | "workable"
  | "jobvite"
  | "successfactors"
  | "bamboohr"
  | "recruitee"
  | "teamtailor"
  | "personio"
  | "microsoft"
  | "workday"
  | "generic";

export interface ATSCompatibilityAdapter {
  displayName: string;
  hostPatterns: RegExp[];
  signatures: string[];
  containers: string[];
  labels: string[];
  options: string[];
  customControls: string[];
  dropZones: string[];
}

export interface ExtractionConfidence {
  overall: number;
  company?: number;
  role?: number;
  description?: number;
  location?: number;
  deadline?: number;
}

export interface CapturedJob {
  company: string;
  role: string;
  url: string;
  source: string;
  platform: string;
  description: string;
  location: string;
  deadline: string | null;
  skills: string[];
  keywords: string[];
  confidence: ExtractionConfidence;
  warnings: string[];
  captured_at: string;
}

export interface ApplicationRecord {
  id: string;
  company: string;
  company_id: string | null;
  role: string;
  url: string;
  source: string;
  description: string;
  location?: string;
  status: ApplicationStatus;
  priority: Priority;
  deadline: string | null;
  applied_at: string | null;
  follow_up_date: string | null;
  resume_version_id: string | null;
  notes: string;
  match_score: number;
  matched_skills?: string[];
  missing_skills?: string[];
  suggested_keywords?: string[];
  suggested_experiences?: string[];
  suggested_answers?: Record<string, string>;
  extraction_confidence?: ExtractionConfidence;
  captured_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  kind: ActionKind;
  title: string;
  status: ActionStatus;
  due_at: string;
  snoozed_until: string | null;
  priority: Priority;
  channel: ActionChannel;
  application_id: string | null;
  contact_id: string | null;
  interview_id: string | null;
  notes: string;
  source: "system" | "user";
  completed_at: string | null;
  last_notified_at: string | null;
  google_calendar_event_id: string | null;
  google_calendar_id: string | null;
  calendar_sync_status: CalendarSyncStatus;
  calendar_synced_at: string | null;
  calendar_sync_error: string | null;
  context_snapshot: {
    company?: string;
    role?: string;
    interview_type?: string;
    contact_name?: string;
  };
  created_at: string;
  updated_at: string;
}

/** @deprecated Serialized as `reminders` for backup/cloud compatibility. */
export type FollowUpReminder = ActionItem;

export interface AnswerMemoryItem {
  id: string;
  question: string;
  answer: string;
  normalized_question: string;
  source: "profile" | "profile_default" | "manual" | "application";
  scope: "global" | "company";
  company_domain: string;
  profile_id: string;
  memory_group: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface LearnedAnswer {
  id: string;
  fingerprint: string;
  question: string;
  normalized_question: string;
  answer: string;
  canonical_field: string | null;
  field_type: string;
  site: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface ResumeVersion {
  id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  dataUrl: string;
  created_at: string;
  is_current: boolean;
}

export interface ContactRecord {
  id: string;
  name: string;
  title: string;
  company: string;
  company_id: string | null;
  email: string;
  phone: string;
  linkedin_url: string;
  preferred_channel: ActionChannel;
  tags: string[];
  relationship: ContactRelationship;
  application_ids: string[];
  notes: string;
  last_contacted_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyRecord {
  id: string;
  name: string;
  domain: string;
  website_url: string;
  notes: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface WaitingItem {
  id: string;
  kind: WaitingKind;
  what: string;
  application_id: string | null;
  contact_id: string | null;
  waiting_since: string;
  expected_by: string | null;
  notes: string;
  status: "open" | "resolved";
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactActivity {
  id: string;
  contact_id: string;
  application_id: string | null;
  interview_id: string | null;
  action_id: string | null;
  type: ContactActivityType;
  direction: ContactActivityDirection;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface ContactImportRow {
  rowNumber: number;
  input: Partial<ContactRecord> & { name: string };
  errors: string[];
  duplicateCandidates: Array<{
    contactId: string;
    name: string;
    exact: boolean;
    reason: "email" | "linkedin" | "name";
  }>;
  decision: "create" | "merge" | "skip";
  mergeTargetId: string | null;
}

export interface InterviewRecord {
  id: string;
  application_id: string;
  type: InterviewType;
  format: InterviewFormat;
  scheduled_at: string | null;
  location: string;
  meeting_url: string;
  interviewer_contact_ids: string[];
  company_research: string;
  preparation_notes: string;
  question_notes: string;
  next_action: string;
  next_action_at: string | null;
  create_preparation_action: boolean;
  preparation_action_at: string | null;
  create_thank_you_action: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StateMigrationRecord {
  from_version: number;
  to_version: number;
  migrated_at: string;
}

export interface ApplyOSState {
  schema_version: number;
  revision: number;
  migration_history: StateMigrationRecord[];
  applications: ApplicationRecord[];
  /** Compatibility serialization key; entries use the ActionItem contract. */
  reminders: ActionItem[];
  answer_memory: AnswerMemoryItem[];
  learned_answers: LearnedAnswer[];
  resume_versions: ResumeVersion[];
  contacts: ContactRecord[];
  contact_activities: ContactActivity[];
  interviews: InterviewRecord[];
  companies: CompanyRecord[];
  waiting_items: WaitingItem[];
  settings: {
    final_follow_up_enabled: boolean;
    notification_enabled: boolean;
    follow_up_offsets_days: number[];
    desktop_notifications_enabled: boolean;
    notification_digest_time: string;
    calendar_auto_sync: boolean;
    cloud_sync_enabled?: boolean;
    resume_sync_enabled?: boolean;
  };
  migrated_at: string;
}

export interface CloudConfig {
  projectUrl: string;
  publishableKey: string;
  provider: "google" | "linkedin_oidc";
  accountRequired: true;
  providers: {
    emailOtp: boolean;
    google: "google";
    linkedin: "linkedin_oidc";
  };
  supportFunction: string;
  deleteFunction: string;
  buildMode: "development" | "production" | "test";
  allowRuntimeConfig: boolean;
}

export interface CloudSyncMeta {
  enabled: boolean;
  status: "off" | "pending" | "syncing" | "synced" | "offline" | "conflict" | "error";
  serverVersion: number;
  lastSyncedAt: string | null;
  conflict: { serverVersion: number; detectedAt: string } | null;
  pendingCount?: number;
  error?: string | null;
}

export type CloudEntityType = "profile" | "application" | "contact" | "contact_activity" | "company" | "waiting_item" | "interview" | "reminder" | "answer_memory" | "learned_answer" | "resume_version" | "knowledge_graph" | "settings" | "onboarding_progress";

export interface CloudMutation {
  mutationId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: "upsert" | "delete";
  baseVersion: number;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

export interface CloudRepositoryMeta {
  cursor: number;
  status: "not_started" | "pending" | "synced" | "offline" | "conflict";
  lastPulledAt: string | null;
  lastFlushedAt: string | null;
  conflict: Record<string, unknown> | null;
}

export interface CandidatePublication {
  visibility: "private" | "recruiters";
  headline: string;
  target_roles: string[];
  location: string;
  skills: string[];
  experience_summary: string;
  portfolio_url: string;
  linkedin_url: string;
  published_at: string | null;
  updated_at: string;
}

export interface BackupSummary {
  created_at: string;
  extension_version: string;
  profiles: number;
  applications: number;
  contacts: number;
  companies: number;
  waiting: number;
  interviews: number;
  answers: number;
}

export interface JobMatchResult {
  score: number;
  jobSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  suggestedKeywords: string[];
  suggestedExperiences: string[];
  suggestedAnswers: Record<string, string>;
}

export interface ProfileMeta {
  id: string;
  name: string;
  targetRole: string;
  color: string;
  createdAt: number;
}

export interface ProfilesIndex {
  activeId: string;
  profiles: ProfileMeta[];
}

export interface EmploymentEntry {
  company?: string;
  title?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface EducationEntry {
  school?: string;
  degree?: string;
  fieldOfStudy?: string;
  graduationDate?: string;
  gpa?: string;
}

export interface UserProfile {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  phoneCountryCode?: string;
  address?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  currentLocation?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  resumeText?: string;
  employment?: EmploymentEntry[];
  education?: EducationEntry[];
  customAnswers?: Array<{ question: string; answer: string; scope?: "global" | "company"; company_domain?: string; source?: "application"; learned_at?: string }>;
  resume?: { name: string; type: string; size: number; dataUrl: string } | null;
  updatedAt?: string;
  profileSchemaVersion?: number;
  onboardingCompletedAt?: string;
  currentResumeVersionId?: string;
  [key: string]: unknown;
}

export interface OllamaConfig {
  endpoint: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  lastChecked: number;
  version: string;
}

export interface KnowledgeNode {
  id: string;
  type: "answer";
  question: string;
  answer: string;
  canonical_field: string | null;
  prompt_type: string;
  source: string;
  confidence: number;
  use_count: number;
  platforms: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  relation: "used_for";
  weight: number;
  created_at: string;
}

export interface RLPattern {
  id: string;
  fingerprint: string;
  canonical_field: string | null;
  successes: number;
  failures: number;
  corrections: number;
  weight: number;
  created_at: string;
  updated_at?: string;
}

export interface KnowledgeGraph {
  schema_version: 1;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  rl_patterns: RLPattern[];
  updated_at: string;
}

export interface AgentAction {
  action: "fill" | "select" | "check" | "skip";
  fieldId: string;
  value: string;
  label: string;
  confidence: number;
}

export interface AgentPlan {
  actions: AgentAction[];
  notes: string;
  reviewRequired: true;
  blockedActions: number;
}
