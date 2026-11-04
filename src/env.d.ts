interface Env {
  AGENT_AUDIT_DISABLED?: string;
  AGENT_LIMITS_NOW?: string;
  APPRAISAL_NOW?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CONFIRMATION_FROM?: string;
  DODO_TINYSTUDIO_API_KEY?: string;
  DODO_TINYSTUDIO_MODE?: string;
  DODO_TINYSTUDIO_PRODUCT_ID?: string;
  DODO_TINYSTUDIO_WEBHOOK_SECRET?: string;
  GOOGLE_ADS_CONVERSION_ID?: string;
  GOOGLE_ADS_CONVERSION_LABEL?: string;
}

interface CodedError extends Error {
  code?: string;
  status?: number;
}

interface EngagementRow {
  id: string;
  request_id: string;
  record_id: string | null;
  status: string;
  checkout_session_id: string | null;
  kickoff_note: string | null;
  specimen_consent: number;
  created_at: string;
  changed_at: string;
}

type EngagementRef = Pick<EngagementRow, "id" | "request_id" | "status">;

interface CorrectionLineRow {
  id: string;
  engagement_id: string;
  request_id: string;
  fault_id: string | null;
  fault_title: string;
  before_text: string;
  after_text: string;
  legal_copy: number;
  status: string;
  reviewer: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  recorded_version: number | null;
  created_at: string;
  changed_at: string;
}

interface AppraisalRequestRow {
  id: string;
  site_url: string;
  business_type: string;
  avg_deal_value: number;
  monthly_leads: number;
  name: string;
  email: string;
  month: string;
  referral_code: string | null;
  confirmation_sent_at: string | null;
  created_at: string;
}

interface AppraisalRecordRow {
  id: string;
  request_id: string;
  version: number;
  rendered_at: string;
  faults_json: string | null;
  review_json: string | null;
}

interface TrackingNoteRow {
  id: string;
  engagement_id: string;
  request_id: string;
  day: number;
  note: string;
  reviewer: string;
  created_at: string;
}

interface Fault {
  id: string;
  type?: string;
  url?: string;
  title?: string;
  evidence?: string;
}

interface FaultReview {
  summary: string;
  keep: string[];
}

interface AppraisalRun {
  version: number;
  renderedAt: string;
  summary: string;
  faults: Fault[];
}

interface DodoPaymentData {
  payment_id?: unknown;
  id?: unknown;
  session_id?: unknown;
  checkout_session_id?: unknown;
  metadata?: Record<string, unknown> | null;
  customer_email?: unknown;
  customer?: { email?: unknown } | null;
  product_cart?: Array<{ product_id?: unknown } | null>;
  total_amount?: unknown;
  amount?: unknown;
  payment_total?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_status?: unknown;
}

interface DodoEvent {
  type?: unknown;
  event_type?: unknown;
  data?: DodoPaymentData | null;
}

interface DeskQueueRow extends EngagementRow {
  site_url: string;
  email: string;
  open_lines: number;
  payment_rows: number;
}
