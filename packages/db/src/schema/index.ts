import { orgRelations } from './org.js';
import { auditLogRelations } from './audit_log.js';

export { org, orgRelations } from './org.js';
export { appUser, appUserRelations } from './app_user.js';
export { modelProfile, modelProfileRelations } from './model_profile.js';
export { consentRecord, consentRecordRelations } from './consent_record.js';
export { platformConnection, platformConnectionRelations } from './platform_connection.js';
export { asset, assetRelations } from './asset.js';
export { contentBundle, contentBundleRelations } from './content_bundle.js';
export { postTarget, postTargetRelations } from './post_target.js';
export { relayCard, relayCardRelations } from './relay_card.js';
export { relayCommand, relayCommandRelations } from './relay_command.js';
export { viralExemplar, viralExemplarRelations } from './viral_exemplar.js';
export { postMetric, postMetricRelations } from './post_metric.js';
export { job, jobRelations } from './job.js';
export { idempotencyLedger, idempotencyLedgerRelations } from './idempotency_ledger.js';
export { auditLog, auditLogRelations } from './audit_log.js';

export const allRelations = [
  orgRelations,
  appUserRelations,
  modelProfileRelations,
  consentRecordRelations,
  platformConnectionRelations,
  assetRelations,
  contentBundleRelations,
  postTargetRelations,
  relayCardRelations,
  relayCommandRelations,
  viralExemplarRelations,
  postMetricRelations,
  jobRelations,
  idempotencyLedgerRelations,
  auditLogRelations,
];
