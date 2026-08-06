import { org, orgRelations } from './org.js';
import { appUser, appUserRelations } from './app_user.js';
import { modelProfile, modelProfileRelations } from './model_profile.js';
import { consentRecord, consentRecordRelations } from './consent_record.js';
import { platformConnection, platformConnectionRelations } from './platform_connection.js';
import { modelNetworkConfigs, modelNetworkConfigsRelations } from './model_network_configs.js';
import { asset, assetRelations } from './asset.js';
import { contentBundle, contentBundleRelations } from './content_bundle.js';
import { postTarget, postTargetRelations } from './post_target.js';
import { relayCard, relayCardRelations } from './relay_card.js';
import { relayCommand, relayCommandRelations } from './relay_command.js';
import { viralExemplar, viralExemplarRelations } from './viral_exemplar.js';
import { postMetric, postMetricRelations } from './post_metric.js';
import { job, jobRelations } from './job.js';
import { idempotencyLedger, idempotencyLedgerRelations } from './idempotency_ledger.js';
import { auditLog, auditLogRelations } from './audit_log.js';

export { org, orgRelations };
export { appUser, appUserRelations };
export { modelProfile, modelProfileRelations };
export { consentRecord, consentRecordRelations };
export { platformConnection, platformConnectionRelations };
export { modelNetworkConfigs, modelNetworkConfigsRelations };
export { asset, assetRelations };
export { contentBundle, contentBundleRelations };
export { postTarget, postTargetRelations };
export { relayCard, relayCardRelations };
export { relayCommand, relayCommandRelations };
export { viralExemplar, viralExemplarRelations };
export { postMetric, postMetricRelations };
export { job, jobRelations };
export { idempotencyLedger, idempotencyLedgerRelations };
export { auditLog, auditLogRelations };

export const allRelations = [
  orgRelations,
  appUserRelations,
  modelProfileRelations,
  consentRecordRelations,
  platformConnectionRelations,
  modelNetworkConfigsRelations,
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
