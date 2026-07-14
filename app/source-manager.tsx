"use client";

import { FormEvent, useState } from "react";
import { ICP_CATALOG } from "../lib/editorial";

type Source = {
  id: number; name: string; domain: string; feedUrl: string; websiteUrl: string | null; type?: string; status?: string;
  active: boolean; health?: string; reliabilityScore: number; priority?: number; collectionFrequencyMinutes?: number;
  language?: string; country?: string; region?: string; relatedIcps?: string[]; notes?: string;
  lastCollectedAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastStatus: string;
  lastDurationMs: number | null; lastHttpStatus: number | null; lastItemCount: number; consecutiveFailures: number;
  nextCollectionAt?: string | null; archivedAt?: string | null; totalNewsCollected?: number; averageResponseMs?: number;
};
type FeedTest = { valid: boolean; status: string; error?: string; httpStatus?: number; itemCount?: number; title?: string; latestItemAt?: string | null; encoding?: string; format?: string; contentType?: string; finalUrl?: string; redirects?: number; durationMs?: number; usesHttps?: boolean };
type Props = { sources: Source[]; busy: boolean; setBusy: (value: boolean) => void; notify: (message: string) => void; refresh: () => Promise<void> };
const HEALTH: Record<string, string> = { healthy: "Saudável", attention: "Atenção", failed: "Com falha", paused: "Pausada", "never-tested": "Nunca testada", archived: "Arquivada" };

export function SourceManager({ sources, busy, setBusy, notify, refresh }: Props) {
  const [editing, setEditing] = useState<Source | null>(null);
  const [test, setTest] = useState<FeedTest | null>(null);
  const [importReport, setImportReport] = useState<{ imported: number; duplicates: number; errors: Array<{ row: number; error: string }> } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value === "test" ? "test" : "save";
    const payload = {
      action, name: form.get("name"), feedUrl: form.get("feedUrl"), websiteUrl: form.get("websiteUrl"),
      reliabilityScore: Number(form.get("reliabilityScore")), priority: Number(form.get("priority")),
      collectionFrequencyMinutes: Number(form.get("collectionFrequencyMinutes")), language: form.get("language"),
      country: form.get("country"), region: form.get("region"), relatedIcps: form.getAll("relatedIcps"), notes: form.get("notes"),
    };
    setBusy(true);
    try {
      const endpoint = editing && action === "save" ? "/api/sources" : "/api/sources";
      const method = editing && action === "save" ? "PATCH" : "POST";
      const body = method === "PATCH" ? { ...payload, id: editing?.id, action: "update" } : payload;
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { source?: Source; test?: FeedTest; error?: string };
      if (data.test) setTest(data.test);
      if (!response.ok) throw new Error(data.error ?? "Falha ao validar a fonte.");
      if (action === "test") { notify(data.test?.valid ? `Feed válido: ${data.test.itemCount ?? 0} item(ns).` : `Feed ${data.test?.status ?? "inválido"}.`); return; }
      notify(editing ? "Fonte atualizada." : "Fonte cadastrada e validada."); setEditing(null); setTest(null); formElement.reset(); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar a fonte."); }
    finally { setBusy(false); }
  }

  async function sourceAction(id: number, action: "activate" | "pause" | "archive") {
    setBusy(true);
    try {
      const response = await fetch("/api/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "A fonte não pôde ser atualizada.");
      notify(action === "activate" ? "Fonte ativada." : action === "pause" ? "Fonte pausada." : "Fonte arquivada."); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao atualizar fonte."); }
    finally { setBusy(false); }
  }

  async function collect(sourceId: number) {
    setBusy(true);
    try {
      const response = await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId }) });
      const data = await response.json() as { found?: number; created?: number; duplicates?: number; ignored?: number; durationMs?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha na coleta.");
      notify(`${data.found ?? 0} encontrados; ${data.created ?? 0} novos; ${data.duplicates ?? 0} duplicados; ${data.ignored ?? 0} ignorados; ${formatDuration(data.durationMs ?? 0)}.`); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha na coleta."); }
    finally { setBusy(false); }
  }

  async function importCsv(file: File) {
    setBusy(true); setImportReport(null);
    try {
      const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", csv: await file.text() }) });
      const data = await response.json() as { imported?: number; duplicates?: number; errors?: Array<{ row: number; error: string }>; error?: string };
      if (!response.ok && data.imported === undefined) throw new Error(data.error ?? "Falha na importação.");
      setImportReport({ imported: data.imported ?? 0, duplicates: data.duplicates ?? 0, errors: data.errors ?? [] });
      notify(`${data.imported ?? 0} fonte(s) importada(s); ${data.duplicates ?? 0} duplicada(s).`); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha na importação."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="panel-title"><h2>{editing ? `Editar ${editing.name}` : "Cadastrar fonte RSS ou Atom"}</h2><div className="inline-actions"><a className="secondary" href="/api/sources?format=csv&includeArchived=true">Exportar CSV</a><label className="secondary file-action">Importar CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.currentTarget.value = ""; }} /></label></div></div>
    <form className="form-grid" onSubmit={submit} key={editing?.id ?? "new"}>
      <div className="form-group"><label className="label" htmlFor="source-name">Nome</label><input required minLength={2} id="source-name" name="name" className="field" defaultValue={editing?.name} /></div>
      <div className="form-group"><label className="label" htmlFor="feed-url">URL do feed</label><input required type="url" id="feed-url" name="feedUrl" className="field" defaultValue={editing?.feedUrl} /></div>
      <div className="form-group"><label className="label" htmlFor="site-url">URL do site</label><input type="url" id="site-url" name="websiteUrl" className="field" defaultValue={editing?.websiteUrl ?? ""} /></div>
      <div className="form-group"><label className="label" htmlFor="reliability">Confiabilidade</label><input id="reliability" name="reliabilityScore" type="number" min="0" max="100" defaultValue={editing?.reliabilityScore ?? 75} className="field" /></div>
      <div className="form-group"><label className="label" htmlFor="priority">Prioridade</label><input id="priority" name="priority" type="number" min="0" max="100" defaultValue={editing?.priority ?? 50} className="field" /></div>
      <div className="form-group"><label className="label" htmlFor="frequency">Frequência</label><select id="frequency" name="collectionFrequencyMinutes" defaultValue={editing?.collectionFrequencyMinutes ?? 720} className="field"><option value="240">A cada 4 horas</option><option value="480">A cada 8 horas</option><option value="720">A cada 12 horas</option><option value="1440">Diária</option></select></div>
      <div className="form-group"><label className="label" htmlFor="language">Idioma</label><input id="language" name="language" defaultValue={editing?.language ?? "pt-BR"} className="field" /></div>
      <div className="form-group"><label className="label" htmlFor="country">País</label><input id="country" name="country" defaultValue={editing?.country ?? "BR"} className="field" /></div>
      <div className="form-group"><label className="label" htmlFor="source-region">Região</label><input id="source-region" name="region" defaultValue={editing?.region ?? "Brasil"} className="field" /></div>
      <div className="form-group"><label className="label" htmlFor="related-icps">ICPs relacionados</label><select multiple id="related-icps" name="relatedIcps" defaultValue={editing?.relatedIcps ?? []} className="field multi-select">{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select></div>
      <div className="form-group full"><label className="label" htmlFor="source-notes">Observações</label><textarea id="source-notes" name="notes" className="field" defaultValue={editing?.notes ?? ""} /></div>
      <div className="form-group full inline-actions"><button className="secondary" name="action" value="test" disabled={busy}>Testar feed</button><button className="primary" name="action" value="save" disabled={busy}>{busy ? "Processando…" : editing ? "Salvar alterações" : "Cadastrar fonte"}</button>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setTest(null); }}>Cancelar</button>}</div>
    </form>
    {test && <div className={`feed-test ${test.valid ? "success" : "error"}`}><div className="panel-title"><h3>{test.valid ? "Feed válido" : `Feed ${test.status}`}</h3><span className={`status ${test.valid ? "sent" : "error"}`}>{test.valid ? "APROVADO" : "REPROVADO"}</span></div>{test.error && <p>{test.error}</p>}<div className="detail-meta"><span><strong>HTTP</strong>{test.httpStatus ?? "—"}</span><span><strong>Formato</strong>{test.format ?? "—"}</span><span><strong>Itens</strong>{test.itemCount ?? 0}</span><span><strong>Feed</strong>{test.title || "Sem título"}</span><span><strong>Encoding</strong>{test.encoding ?? "—"}</span><span><strong>Duração</strong>{formatDuration(test.durationMs ?? 0)}</span><span><strong>Redirecionamentos</strong>{test.redirects ?? 0}</span><span><strong>HTTPS</strong>{test.usesHttps ? "Sim" : "Não"}</span></div></div>}
    {importReport && <div className="notice">Importadas: {importReport.imported} · duplicadas: {importReport.duplicates} · erros: {importReport.errors.length}{importReport.errors.map((error) => <div key={`${error.row}-${error.error}`}>Linha {error.row}: {error.error}</div>)}</div>}
    <div style={{ marginTop: 24 }}><div className="panel-title"><h2>Fontes cadastradas</h2><small>{sources.length} total</small></div>{sources.length ? sources.map((item) => <div className="source-card" key={item.id}><div className="source-card-main"><div className="source-logo">{initials(item.name)}</div><div><div className="source-name">{item.name}</div><div className="source-meta">{item.feedUrl}</div><div className="tags"><span className={`status health-${item.health}`}>{HEALTH[item.health ?? "never-tested"] ?? item.health}</span><span className="tag">HTTP {item.lastHttpStatus ?? "—"}</span><span className="tag">{item.totalNewsCollected ?? 0} notícias</span><span className="tag">{formatDuration(item.averageResponseMs ?? 0)} média</span></div>{item.lastError && <div className="source-error">{item.lastError}</div>}</div></div><div className="source-stats"><span><strong>Último sucesso</strong>{item.lastSuccessAt ? formatDate(item.lastSuccessAt) : "Nunca"}</span><span><strong>Próxima coleta</strong>{item.nextCollectionAt ? formatDate(item.nextCollectionAt) : "Após a primeira coleta"}</span><span><strong>Falhas</strong>{item.consecutiveFailures}</span></div><div className="inline-actions wrap"><button className="secondary" disabled={busy || !item.active} onClick={() => void collect(item.id)}>Coletar agora</button><button className="ghost" disabled={busy} onClick={() => setEditing(item)}>Editar</button>{item.active ? <button className="ghost" disabled={busy} onClick={() => void sourceAction(item.id, "pause")}>Pausar</button> : !item.archivedAt && <button className="ghost" disabled={busy} onClick={() => void sourceAction(item.id, "activate")}>Ativar</button>}<button className="ghost" disabled={busy || Boolean(item.archivedAt)} onClick={() => void sourceAction(item.id, "archive")}>Arquivar</button></div></div>) : <div className="empty"><strong>Nenhuma fonte ativa.</strong>Cadastre e teste o primeiro feed para iniciar a operação.</div>}</div>
  </>;
}

function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatDuration(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
