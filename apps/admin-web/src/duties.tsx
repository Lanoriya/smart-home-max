import { useEffect, useState } from 'react';
import { api } from './api';

// The duties of a management company by law, as residents see them in the
// app and the bot. A company edits its own version (the platform's text stays
// for those who have none); the platform edits the common text.

type DutyBlock = { title: string; source: string; items: string[] };
type Draft = { title: string; source: string; text: string };
type Notify = (text: string, tone?: 'success' | 'error') => void;

const toDraft = (items: DutyBlock[]): Draft[] => items.map((block) => ({ title: block.title, source: block.source, text: block.items.join('\n') }));
const fromDraft = (drafts: Draft[]): DutyBlock[] => drafts
  .map((draft) => ({ title: draft.title.trim(), source: draft.source.trim(), items: draft.text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 2) }))
  .filter((block) => block.title.length >= 2 && block.items.length);

export function DutiesManager({ scope, onNotice }: { scope: 'company' | 'platform'; onNotice: Notify }) {
  const url = scope === 'company' ? '/api/settings/duties' : '/api/app/platform/duties';
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const apply = (data: { items: DutyBlock[]; own?: boolean; law?: DutyBlock[] }) => {
    setDrafts(toDraft(data.items));
    setCustom(scope === 'company' ? Boolean(data.own) : JSON.stringify(data.items) !== JSON.stringify(data.law));
  };
  useEffect(() => { void api<{ items: DutyBlock[]; own?: boolean; law?: DutyBlock[] }>(url).then(apply).catch(() => onNotice('Не удалось загрузить обязанности.', 'error')); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!drafts) return <p className="state-message">Загружаем…</p>;
  const change = (index: number, patch: Partial<Draft>) => setDrafts((current) => current!.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const save = async (items: DutyBlock[] | null) => {
    setBusy(true);
    try {
      apply(await api<{ items: DutyBlock[]; own?: boolean; law?: DutyBlock[] }>(url, { method: 'PUT', body: JSON.stringify({ items }) }));
      onNotice(items ? 'Обязанности сохранены. Жители видят их в приложении и в боте.' : scope === 'company' ? 'Вернули общий текст.' : 'Вернули текст законов.');
    } catch { onNotice('Не удалось сохранить: у каждого блока нужен заголовок и хотя бы одна обязанность.', 'error'); } finally { setBusy(false); }
  };
  const blocks = fromDraft(drafts);
  return <section className="panel">
    <div className="panel-head">
      <div><h2>{scope === 'company' ? (custom ? 'Ваша версия для жителей' : 'Общий текст по законам') : 'Общий текст для всех УК'}</h2>
        <p className="form-hint">{scope === 'company'
          ? 'Жители видят этот текст в «Моя УК» и в боте. Можно дописать более короткие сроки из договора управления — сохранится ваша версия.'
          : 'Его видят жители всех УК, у которых нет своей версии. Исходный текст сверен с действующими редакциями ПП РФ № 416, № 354, № 290 и Постановления Госстроя № 170.'}</p></div>
      <div className="panel-actions">
        {custom ? <button className="filter" type="button" disabled={busy} onClick={() => { if (window.confirm(scope === 'company' ? 'Вернуть общий текст? Ваша версия удалится.' : 'Вернуть исходный текст по законам? Правки удалятся.')) void save(null); }}>{scope === 'company' ? 'Вернуть общий текст' : 'Вернуть текст законов'}</button> : null}
        <button className="primary" type="button" disabled={busy || !blocks.length} onClick={() => void save(blocks)}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </div>
    <div className="duties-grid">
      {drafts.map((draft, index) => <div className="status-form duty-block" key={index}>
        <div className="duty-head"><strong>Блок {index + 1}</strong><button className="filter danger small" type="button" onClick={() => setDrafts((current) => current!.filter((_, at) => at !== index))}>Убрать</button></div>
        <label>Заголовок<input maxLength={120} value={draft.title} onChange={(event) => change(index, { title: event.target.value })} placeholder="Аварийно-диспетчерская служба" /></label>
        <label>Обязанности и сроки<textarea rows={Math.min(14, Math.max(4, draft.text.split('\n').length + 1))} value={draft.text} onChange={(event) => change(index, { text: event.target.value })} /><span className="field-hint">Одна обязанность в строке.</span></label>
        <label>Основание<input maxLength={200} value={draft.source} onChange={(event) => change(index, { source: event.target.value })} placeholder="ПП РФ № 416, п. 13" /></label>
      </div>)}
      {drafts.length < 15 ? <button className="filter duty-add" type="button" onClick={() => setDrafts((current) => [...current!, { title: '', source: '', text: '' }])}>Добавить блок</button> : null}
    </div>
  </section>;
}
