import postgres from "postgres";
import { inspectFeed } from "../lib/ingestion.ts";
import { PRIORITY_EDITORIAL_SOURCES } from "../lib/priority-editorial-sources.ts";
import { calculateSourceAuthorityScore, isRecentFeedItem } from "../lib/source-governance.ts";

const SEED_VERSION = "2026.07.16-priority-v1";
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--verify-only") ? "verify" : null;

if (!mode) {
  console.error("Uso seguro: --verify-only testa os feeds sem escrever; --apply valida e faz upsert aditivo.");
  process.exitCode = 2;
} else {
  const results = await verifyAll(PRIORITY_EDITORIAL_SOURCES, 4);
  const summary = summarize(results);
  const report = results.map((result) => ({
    sourceKey: result.sourceKey,
    name: result.source.name,
    status: result.status,
    activeForCollection: result.activeForCollection,
    monitoringMode: result.monitoringMode,
    feedUrl: result.feedUrl,
    attempts: result.attempts.map((attempt) => ({
      url: attempt.url,
      status: attempt.status,
      httpStatus: attempt.httpStatus ?? null,
      itemCount: attempt.itemCount ?? null,
      durationMs: attempt.durationMs,
      error: attempt.error ?? null,
    })),
  }));
  console.log(JSON.stringify({ seedVersion: SEED_VERSION, mode, summary, sources: report }, null, 2));
  if (mode === "apply") await applySeed(results);
}

async function verifyAll(sources, concurrency) {
  const results = new Array(sources.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    while (next < sources.length) {
      const index = next;
      next += 1;
      results[index] = await verifySource(sources[index]);
    }
  }));
  return results;
}

async function verifySource(source) {
  const attempts = [];
  for (const candidate of source.feedCandidates) {
    const inspection = await inspectFeed(candidate);
    attempts.push({ url: candidate, ...inspection });
    if (inspection.valid && isRecentFeedItem(inspection.latestItemAt)) {
      return {
        sourceKey: source.sourceKey,
        source,
        status: "verified",
        activeForCollection: true,
        monitoringMode: inspection.format === "atom" ? "atom" : "rss",
        feedUrl: inspection.finalUrl,
        verification: inspection,
        attempts,
      };
    }
    if (inspection.valid) {
      attempts[attempts.length - 1] = { ...attempts.at(-1), valid: false, status: "stale", error: "O feed não possui itens recentes." };
    }
  }
  return {
    sourceKey: source.sourceKey,
    source,
    status: source.feedCandidates.length ? "feed_not_verified" : "reference",
    activeForCollection: false,
    monitoringMode: "reference",
    feedUrl: null,
    verification: null,
    attempts,
  };
}

function summarize(results) {
  return {
    total: results.length,
    verified: results.filter((item) => item.status === "verified").length,
    reference: results.filter((item) => item.status === "reference").length,
    feedNotVerified: results.filter((item) => item.status === "feed_not_verified").length,
    activeForCollection: results.filter((item) => item.activeForCollection).length,
  };
}

async function applySeed(results) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL não foi configurada. O seed não foi aplicado.");

  const sql = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 10 });
  const now = new Date().toISOString();
  try {
    await sql.begin(async (tx) => {
      for (const result of results) {
        const source = result.source;
        let operationalSourceId = null;

        if (result.activeForCollection && result.feedUrl) {
          const existing = await tx`
            SELECT id FROM sources
            WHERE feed_url = ${result.feedUrl} OR website_url = ${source.baseUrl}
            ORDER BY CASE WHEN feed_url = ${result.feedUrl} THEN 0 ELSE 1 END
            LIMIT 1
          `;
          if (existing[0]) {
            operationalSourceId = existing[0].id;
          } else {
            const inserted = await tx`
              INSERT INTO sources (
                name, domain, feed_url, website_url, reliability_score, active, type, status,
                priority, collection_frequency_minutes, language, country, region, related_icps,
                notes, last_status, created_at, updated_at
              ) VALUES (
                ${source.name}, ${source.domain}, ${result.feedUrl}, ${source.baseUrl}, ${source.reliability},
                TRUE, ${result.monitoringMode}, 'active', ${source.priority}, ${source.updateFrequencyMinutes},
                ${source.language}, ${source.country}, ${source.geographicScope}, ${JSON.stringify(source.relatedIcps)},
                ${`Seed editorial ${SEED_VERSION}; feed validado antes da ativação.`}, 'never', ${now}, ${now}
              )
              ON CONFLICT (feed_url) DO NOTHING
              RETURNING id
            `;
            operationalSourceId = inserted[0]?.id ?? null;
            if (!operationalSourceId) {
              const concurrent = await tx`SELECT id FROM sources WHERE feed_url = ${result.feedUrl} LIMIT 1`;
              operationalSourceId = concurrent[0]?.id ?? null;
            }
          }
        }

        const authorityScore = calculateSourceAuthorityScore({ sourceType: source.sourceType, authorityProfile: source.authorityProfile });
        const c = source.capabilities;
        await tx`
          INSERT INTO editorial_sources (
            operational_source_id, source_key, name, domain, base_url, feed_url, category, subcategories,
            authority_level, authority_score, source_type, editorial_role, primary_or_secondary,
            official_entity, country, language, monitoring_mode, active_for_collection, status,
            reliability, priority, update_frequency_minutes, topics_allowed, topics_restricted,
            geographic_scope, related_icps, requires_cross_check, preferred_original_source,
            paywall, requires_javascript, sitemap_url, last_verified_at, editorial_notes,
            bias_or_interest_disclosure, minimum_confirmation_sources, can_confirm_regulation,
            can_confirm_statistics, can_confirm_company_events, can_confirm_operational_disruption,
            can_confirm_prices, can_confirm_weather, can_confirm_international_trade, created_at, updated_at
          ) VALUES (
            ${operationalSourceId}, ${source.sourceKey}, ${source.name}, ${source.domain}, ${source.baseUrl}, ${result.feedUrl},
            ${source.category}, ${JSON.stringify(source.subcategories)}, ${source.authorityLevel}, ${authorityScore},
            ${source.sourceType}, ${source.editorialRole}, ${source.primaryOrSecondary}, ${source.officialEntity},
            ${source.country}, ${source.language}, ${result.monitoringMode}, ${result.activeForCollection}, ${result.status},
            ${source.reliability}, ${source.priority}, ${source.updateFrequencyMinutes}, ${JSON.stringify(source.topicsAllowed)},
            ${JSON.stringify(source.topicsRestricted)}, ${source.geographicScope}, ${JSON.stringify(source.relatedIcps)},
            ${source.requiresCrossCheck}, ${source.preferredOriginalSource}, ${source.paywall}, ${source.requiresJavascript},
            ${source.sitemapUrl}, ${result.verification ? now : null}, ${source.editorialNotes},
            ${source.biasOrInterestDisclosure}, ${source.minimumConfirmationSources}, ${c.regulation}, ${c.statistics},
            ${c.companyEvents}, ${c.operationalDisruption}, ${c.prices}, ${c.weather}, ${c.internationalTrade}, ${now}, ${now}
          )
          ON CONFLICT (source_key) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            subcategories = EXCLUDED.subcategories,
            authority_level = EXCLUDED.authority_level,
            authority_score = EXCLUDED.authority_score,
            source_type = EXCLUDED.source_type,
            editorial_role = EXCLUDED.editorial_role,
            primary_or_secondary = EXCLUDED.primary_or_secondary,
            official_entity = EXCLUDED.official_entity,
            country = EXCLUDED.country,
            language = EXCLUDED.language,
            reliability = EXCLUDED.reliability,
            priority = EXCLUDED.priority,
            topics_allowed = EXCLUDED.topics_allowed,
            topics_restricted = EXCLUDED.topics_restricted,
            geographic_scope = EXCLUDED.geographic_scope,
            related_icps = EXCLUDED.related_icps,
            requires_cross_check = EXCLUDED.requires_cross_check,
            preferred_original_source = EXCLUDED.preferred_original_source,
            bias_or_interest_disclosure = EXCLUDED.bias_or_interest_disclosure,
            minimum_confirmation_sources = EXCLUDED.minimum_confirmation_sources,
            can_confirm_regulation = EXCLUDED.can_confirm_regulation,
            can_confirm_statistics = EXCLUDED.can_confirm_statistics,
            can_confirm_company_events = EXCLUDED.can_confirm_company_events,
            can_confirm_operational_disruption = EXCLUDED.can_confirm_operational_disruption,
            can_confirm_prices = EXCLUDED.can_confirm_prices,
            can_confirm_weather = EXCLUDED.can_confirm_weather,
            can_confirm_international_trade = EXCLUDED.can_confirm_international_trade,
            updated_at = EXCLUDED.updated_at
        `;
      }
    });
    console.log(JSON.stringify({ applied: true, seedVersion: SEED_VERSION, ...summarize(results) }));
  } finally {
    await sql.end();
  }
}
