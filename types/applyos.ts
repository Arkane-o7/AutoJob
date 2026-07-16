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

export interface FollowUpReminder {
  id: string;
  application_id: string;
  type: "follow_up" | "final_follow_up";
  due_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface AnswerMemoryItem {
  id: string;
  question: string;
  answer: string;
  normalized_question: string;
  source: "profile" | "manual" | "application";
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
  created_at: string;
  is_current: boolean;
}

export interface ContactRecord {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedin_url: string;
  relationship: ContactRelationship;
  application_ids: string[];
  notes: string;
  last_contacted_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
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
  reminders: FollowUpReminder[];
  answer_memory: AnswerMemoryItem[];
  learned_answers: LearnedAnswer[];
  resume_versions: ResumeVersion[];
  contacts: ContactRecord[];
  interviews: InterviewRecord[];
  settings: {
    final_follow_up_enabled: boolean;
    notification_enabled: boolean;
  };
  migrated_at: string;
}

export interface BackupSummary {
  created_at: string;
  extension_version: string;
  profiles: number;
  applications: number;
  contacts: number;
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
  customAnswers?: Array<{ question: string; answer: string }>;
  resume?: { name: string; type: string; size: number; dataUrl: string } | null;
  updatedAt?: string;
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
