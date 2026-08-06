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
import { authUser, authUserRelations } from './auth_user.js';
import { authSession, authSessionRelations } from './auth_session.js';
import { authAccount, authAccountRelations } from './auth_account.js';
import { authVerification } from './auth_verification.js';
import { orgSettings, orgSettingsRelations } from './org_settings.js';
import { fanCrmContact, fanCrmContactRelations } from './fan_crm_contact.js';
import { fanTouchpoint, fanTouchpointRelations } from './fan_touchpoint.js';
import { customRequest, customRequestRelations } from './custom_request.js';
import { linkbioProvider, linkbioProviderRelations } from './linkbio_provider.js';
import { linkbioClick, linkbioClickRelations } from './linkbio_click.js';
import { shortLink, shortLinkRelations } from './short_link.js';
import { playbookScore, playbookScoreRelations } from './playbook_score.js';

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
export { authUser, authUserRelations };
export { authSession, authSessionRelations };
export { authAccount, authAccountRelations };
export { authVerification };
export { orgSettings, orgSettingsRelations };
export { fanCrmContact, fanCrmContactRelations };
export { fanTouchpoint, fanTouchpointRelations };
export { customRequest, customRequestRelations };
export { linkbioProvider, linkbioProviderRelations };
export { linkbioClick, linkbioClickRelations };
export { shortLink, shortLinkRelations };
export { playbookScore, playbookScoreRelations };

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
  authUserRelations,
  authSessionRelations,
  authAccountRelations,
  orgSettingsRelations,
  fanCrmContactRelations,
  fanTouchpointRelations,
  customRequestRelations,
  linkbioProviderRelations,
  linkbioClickRelations,
  shortLinkRelations,
  playbookScoreRelations,
];
