/**
 * webfetch-core public API surface.
 *
 * Zero MCP concerns live here — this is a pure TypeScript library that an
 * agent, CLI, or any other runtime can use directly.
 */

export * from "./types.ts";
export { searchImages } from "./federation.ts";
export { getFederationRepairPlan, detectPatterns, generateRecommendations } from "./federation-repair.ts";
export type { FederationContext, FailurePattern } from "./federation-repair.ts";
export { computeFederationFallback } from "./federation-fallback.ts";
export type {
  FallbackStrategyInput,
  FallbackStrategyResult,
  SearchOptionsWithFallback,
} from "./federation-fallback.ts";
export {
  clusterCandidates,
  levenshteinSimilarity,
  pHashSimilarity,
  metadataSimilarity,
  providerRankScore,
  computeClusterMetrics,
} from "./semantic-clustering.ts";
export { pickBest, rankAll, refineSearchResults, extractPhashDedupeMetrics } from "./pick.ts";
export { assertPublicHttpUrl, downloadImage, DownloadError } from "./download.ts";
export { fetchWithLicense, parseHtmlLicense } from "./fetch-with-license.ts";
export { probePage, extractImages } from "./probe-page.ts";
export { findSimilar } from "./find-similar.ts";
export { batchFindSimilar, batchFindSimilarWithFederation } from "./batch-find-similar.ts";
export type {
  BatchFindSimilarInput,
  BatchFindSimilarOutput,
  BatchFindSimilarResult,
  FederatedImageInput,
  FederatedImageResult,
  BatchProviderSummary,
  BatchFederationOutput,
  BatchFederationOptions,
} from "./batch-find-similar.ts";
export { findSimilarBatch, classifyDistance } from "./find-similar-batch.ts";
export { batchClusterByPhash } from "./batch-phash-cluster.ts";
export type {
  ClusterGroup as PhashClusterGroup,
  BatchClusterMetrics,
  BatchPhashClusterResult,
  BatchPhashClusterOptions,
} from "./batch-phash-cluster.ts";
export {
  perceptualHash,
  perceptualHashStructured,
  phashToString,
  dedupeByHash,
  dedupeByUrl,
  hammingDistance,
  findDuplicates,
  compareCandidates,
  dedupeWithPhashGrouping,
  dedupeImagesByPhash,
} from "./dedupe.ts";
export type { CompareCandidatesOptions, DedupeByHashOptions } from "./dedupe.ts";
export {
  batchHammingDistances,
  hammingPercentile,
  hammingDistanceMatrix,
  phashDistanceStats,
  phashBatchValidation,
} from "./perceptual-hash.ts";
export type {
  PhashDistanceStats,
  HammingCandidate,
  HammingPercentileResult,
  PhashValidationAssertion,
  PhashBatchValidationResult,
} from "./perceptual-hash.ts";
export { readImageMetadata, parseXmp, parseIptc, parseExifBuffer } from "./metadata-reader.ts";
export type { EmbeddedMetadata } from "./metadata-reader.ts";
export { auditImageMetadata, levenshteinSimilarity as levenshteinSimilarityAudit } from "./image-metadata-audit.ts";
export type {
  ImageMetadataAuditInput,
  ImageMetadataAuditResult,
  ProviderMetadataSubset,
  MergedMetadata,
  FieldConflict,
  MetadataAuditEvent,
} from "./image-metadata-audit.ts";
export {
  buildAttribution,
  coerceLicense,
  heuristicLicenseFromUrl,
  isContextSafeLicense,
  isOpenLicense,
  isSafeLicense,
  prettyLicenseName,
  requiresAttribution,
  CONTEXT_SAFE_LICENSES,
  OPEN_LICENSES,
  PLATFORM_LICENSES,
  SAFE_LICENSES,
  LICENSE_RANK,
  // Attribution audit trail (re-exported via license.ts → attribution-audit.ts)
  coerceLicenseWithTrail,
  heuristicLicenseFromUrlWithTrail,
  validateAttributionLine,
} from "./license.ts";
export type {
  LicenseAuditTrail,
  LicenseAuditSource,
  LicenseAuditFlag,
  AttributionValidationResult,
  AttributionValidationOptions,
} from "./license.ts";
export { searchArtistImages, searchAlbumCover, searchEventPhotos } from "./hints/index.ts";
export type { ArtistImageKind } from "./hints/index.ts";
export { ALL_PROVIDERS, DEFAULT_PROVIDERS, DEFAULT_PROVIDER_IDS, PROVIDER_IDS, bootstrapRegistry } from "./providers/index.ts";
export {
  providerRegistry,
  createProviderRegistry,
  registerProvider,
  loadProvidersFromModules,
  resolveProviderAuth,
  listPluginProviders,
  getPluginProvider,
  unregisterPluginProvider,
  _clearPluginRegistry,
} from "./provider-registry.ts";
export type {
  ProviderCapability,
  ProviderMetadata,
  ProviderRegistryInterface,
  ProviderPluginDescriptor,
  ModuleLoadResult,
  ResolvedProviderAuth,
  ResolveProviderAuthOptions,
} from "./provider-registry.ts";
export { defaultCacheDir, cachePath, readCache, writeCache, ensureCacheDir } from "./cache.ts";
export {
  getCacheStats,
  queryCacheByHash,
  listCacheEntries,
  clearCacheEntry,
  exportCache,
  importCache,
} from "./cache-inspection.ts";
export type {
  CacheStats,
  CacheEntryDetail,
  CacheEntryListing,
  ClearCacheResult,
  ExportCacheResult,
  ExportFilter,
  ImportCacheResult,
} from "./cache-inspection.ts";
export {
  emitProviderEvent,
  emitProviderSequenceEvent,
  getFederationDiagnostics,
  getProviderRanking,
  getProviderSequenceEvents,
  computeProviderRecommendations,
  getFederationHealthReport,
  getFederationTrends,
  detectProviderAnomalies,
  exportFederationAudit,
  getFederationDiagnosticsTrends,
  recordFederationHashMetrics,
  _resetTelemetry,
} from "./federation-telemetry.ts";
export { getBucketState } from "./rate-limit.ts";
export {
  healthCheckProvider,
  getProviderHealthStatus,
  checkAllProviders,
  getDegradationMultiplier,
  getCircuitState,
  degradeBucketCapacity,
  PROVIDER_ENDPOINTS,
  _resetHealthCache,
  _resetCircuitBreakers,
  _resetDegradationLevels,
  degradationLevels,
} from "./provider-health-check.ts";
export type {
  ProviderHealthCheck,
  HealthStatus,
  HealthMetrics,
  HealthCheckOptions,
} from "./provider-health-check.ts";
export type {
  ProviderEvent,
  ProviderRankEntry,
  ProviderRanking,
  ProviderSequenceEvent,
  ProviderStats,
  FederationSummary,
  FederationDiagnostics,
  ProviderHealthStatus,
  ProviderRecommendation,
  ProviderRecommendations,
  FederationHealthReport,
  PerformanceInsight,
  LicenseCoverageEntry,
  LicenseCoverageHeatmap,
  PerQueryAdvice,
  CostBenefitEntry,
  LatencyPercentiles,
  ProviderWindowTrend,
  FederationTrendReport,
  AnomalyEvent,
  FederationDiagnosticsTrendsResult,
  FederationHashMetrics,
} from "./federation-telemetry.ts";
export {
  recordSearchEvent,
  getCacheReplayStats,
  getCacheAnalyticsSnapshot,
  replayQuery,
  cacheHitRateByProvider,
  getHotQueries,
  recomputeProviderRecommendations,
  exportCacheMetrics,
  _resetAnalytics,
} from "./cache-analytics.ts";
export type {
  CandidateHit,
  SearchEvent,
  ProviderCoverageEntry,
  QueryCoverageRow,
  CacheReplayStats,
  ReplayOptions,
  ReplayResult,
  CacheAnalyticsSnapshot,
  ProviderHitRateSummary,
  HotQueryEntry,
  CacheAwareProviderRec,
  CacheMetricsRow,
  CacheMetricsExport,
} from "./cache-analytics.ts";
export { analyzePhashQuality } from "./phash-diagnostics.ts";
export type {
  AlgorithmStats,
  AlgorithmMix,
  ConfidenceDistribution,
  PhashDiagnosticsResult,
} from "./phash-diagnostics.ts";

export {
  analyzeHashSimilarity,
  percentileSimilarity,
  hashQualityReport,
  computeHashMetrics,
  HISTOGRAM_BUCKET_LABELS,
} from "./phash-analytics.ts";
export type {
  HashHistogramBucket,
  HashSimilarityAnalysis,
  PercentileSimilarityResult,
  AlgorithmBucket,
  ConfidenceTierBreakdown,
  HashQualityReport,
  HashMetrics,
} from "./phash-analytics.ts";

export {
  reconcileLicenses,
  reconcileLicensesAll,
  levenshteinSimilarity as levenshteinSimilarityReconcile,
  buildEvidenceChain,
  scoreLicenseConsensus,
  recommendLicenseUpgrade,
  reconcileLicensesBatch,
  auditLicenseConflict,
} from "./license-reconciliation.ts";

export {
  exportImageMetadata,
  buildXmpSidecar,
  buildJsonSidecar,
  embedExifUserComment,
  licenseUrl as metadataLicenseUrl,
} from "./metadata-export.ts";
export type {
  ExportFormat,
  ExportMetadataOptions,
  ExportResult,
  ImageExportMetadata,
} from "./metadata-export.ts";
export type {
  LicenseEvidenceItem,
  LicenseConflictEntry,
  LicenseReconciliationResult,
  LicenseConsensusScore,
  LicenseUpgradeRecommendation,
  BatchReconciliationEntry,
  BatchReconciliationResult,
  LicenseConflictAudit,
} from "./license-reconciliation.ts";

export {
  recordScorecardEvent,
  getProviderScore,
  getAllProviderScores,
  getScorecardSnapshot,
  selectProvidersForQuery,
  computeLicenseDiversity,
  enableScorecardPersistence,
  disableScorecardPersistence,
  loadScorecardFromDisk,
  _resetScorecard,
} from "./provider-scorecard.ts";
export type {
  ScorecardEvent,
  ProviderScore,
  ProviderSelectionMode,
  SelectionWeights,
} from "./provider-scorecard.ts";

export {
  trackEvent,
  isTelemetryEnabled,
  installHash,
  buildPayload,
  ALLOWED_EVENTS,
  DEFAULT_ENDPOINT,
  FALLBACK_ENDPOINT,
  TELEMETRY_SALT,
} from "./telemetry.ts";
export {
  validateProviderRegistry,
  getCapabilityMatrix,
  _resetValidatorCache,
} from "./provider-validator-runtime.ts";
export type {
  QueryIntent,
  ProviderValidationResult,
  CapabilityMatrixEntry,
  ProviderCapabilityMatrix,
  ProviderRegistryValidationResult,
  ValidateRegistryOptions,
} from "./provider-validator-runtime.ts";
export type {
  TelemetryEvent,
  TelemetryProps,
  TelemetryOptions,
  TelemetryConfig,
  TelemetryPayload,
  Fetcher as TelemetryFetcher,
} from "./telemetry.ts";

export {
  validatePluginManifest,
} from "./provider-plugin-manifest.ts";
export type {
  PluginCapability,
  PluginAuth,
  PluginManifest,
  PluginManifestValidationResult,
} from "./provider-plugin-manifest.ts";

export {
  loadPluginFromPath,
  watchPluginDirectory,
  bootstrapPluginDirectory,
} from "./provider-plugin-loader.ts";
export type {
  PluginLoadResult,
  PluginWatcher,
  WatchPluginDirectoryOptions,
} from "./provider-plugin-loader.ts";

export {
  clusterCandidatesBySemantic,
  buildHammingMatrix,
  agglomerativeCluster,
  selectCentroid,
  extractDescription,
} from "./semantic-dedupe.ts";
export type {
  AlternateUrl,
  SemanticDedupeCluster,
  SemanticDedupeCandidate,
  SemanticDedupeResult,
  SemanticDedupeOptions,
} from "./semantic-dedupe.ts";
