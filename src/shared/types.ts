export type Variation = 'natural' | 'higher' | 'lower' | 'singing';
export interface Policy { originalMethodOnly: boolean; maxRefundCents: number; requireApproval: boolean; version: number }
export interface Order { id: string; product: string; paidCents: number; refundedCents: number; currency: 'USD'; paymentMethod: string; eligible: boolean }
export interface RefundAction { requiresVoice?: boolean; id: string; orderId: string; amountCents: number; destination: string; currency: 'USD'; status: 'pending' | 'executed'; createdAt: string; expiresAt: string; policyVersion: number }
export interface Approval { id: string; actionId: string; digest: string; policyVersion: number; expiresAt: string; used: boolean }
export interface VoiceSample { transcript?: string | null; id: string; variation: Variation; createdAt: string; bytes: number; embedding: number[] | null; model: string | null }
export interface PhraseCheck { status: 'matched' | 'mismatch' | 'unavailable'; expected: string; transcript: string | null; message: string }
export interface VoiceResult { baselineSampleId?: string; phrase?: PhraseCheck; speakerStatus?: 'consistent' | 'uncertain' | 'unavailable'; status: 'consistent' | 'uncertain' | 'unavailable'; score: number | null; scores: { variation: Variation; score: number }[]; threshold: number; message: string; model: string | null }
export interface AuditEvent { id: string; time: string; event: string; detail: string }
export interface Credential { id: string; publicKey: string; counter: number }
export interface Profile { name: string; credential: Credential | null; voices: VoiceSample[] }
export interface ReplayCase { name: string; attack: boolean; before: boolean; after: boolean; passed: boolean; reason: string }
export interface Finding { id: string; title: string; description: string; active: boolean }
export interface DoctorReport { generatedAt: string; policyVersion: number; proposed: Policy; findings: Finding[]; replay: ReplayCase[]; verified: boolean; codeScan: { status: 'complete' | 'unavailable'; findings: { rule: string; path: string; line: number; message: string }[]; message: string } }
export interface Workspace { revision: number; profile: Profile; orders: Order[]; policy: Policy; previousPolicy: Policy | null; actions: RefundAction[]; approvals: Approval[]; audit: AuditEvent[]; doctor: DoctorReport | null }
export interface IntegrationStatus { mongodb: { mode: 'mongodb' | 'local'; connected: boolean }; elevenlabs: { configured: boolean }; speaker: { ready: boolean; model: string | null }; semgrep: { available: boolean } }
export interface AppState extends Omit<Workspace, 'profile' | 'approvals'> { profile: { name: string; hasPasskey: boolean; voices: Omit<VoiceSample,'embedding'>[] }; integrations: IntegrationStatus; authenticated: boolean }
