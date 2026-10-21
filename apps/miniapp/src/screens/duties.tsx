import { useEffect, useState } from 'react';
import { Button, Input, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type DutyBlock } from '../api';
import { useLoad } from '../session';
import { useConfirm } from '../components/confirm';
import { Actions, Failure, Field, Loading, Page, Section } from '../components/ui';

// What a management company owes its houses by law, with the longest terms.
// The text comes from the server: the company's own version, else the
// platform's, else the current texts of the regulations.

export const dutiesFootnote = 'Договор управления дома может устанавливать более короткие сроки. Если УК их нарушает, можно пожаловаться в государственную жилищную инспекцию региона.';

export function DutyBlocks({ items }: { items: DutyBlock[] }) {
  return (
    <>
      {items.map((block, index) => (
        <section key={`${block.title}-${index}`} className="section">
          <h2 className="section-header">{block.title}</h2>
          <div className="info-card duties-card">
            <ul className="duties-list">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
            {block.source ? <span className="duties-source">{block.source}</span> : null}
          </div>
        </section>
      ))}
    </>
  );
}

export function DutiesScreen() {
  const data = useLoad(() => api.duties(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  return (
    <Page title="Обязанности УК" subtitle="Что УК должна делать по закону и в какие сроки">
      <DutyBlocks items={data.data.items} />
      <p className="field-hint duties-footnote">{dutiesFootnote}</p>
    </Page>
  );
}

type Draft = { title: string; source: string; text: string };
const toDraft = (items: DutyBlock[]): Draft[] => items.map((block) => ({ title: block.title, source: block.source, text: block.items.join('\n') }));
const fromDraft = (drafts: Draft[]): DutyBlock[] => drafts
  .map((draft) => ({ title: draft.title.trim(), source: draft.source.trim(), items: draft.text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 2) }))
  .filter((block) => block.title.length >= 2 && block.items.length);

// One editor for a company and for the platform: blocks with a title, the
// legal basis and one duty per line.
export function DutiesEditor({ initial, own, resetLabel, resetText, onSave, onReset }: {
  initial: DutyBlock[]; own: boolean; resetLabel: string; resetText: string;
  onSave: (items: DutyBlock[]) => Promise<void>; onReset: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState(() => toDraft(initial));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(toDraft(initial)), [initial]);
  const change = (index: number, patch: Partial<Draft>) => setDrafts((current) => current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const blocks = fromDraft(drafts);
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try { await action(); showSnackbar({ text: done }); } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setBusy(false); }
  };
  return (
    <>
      {drafts.map((draft, index) => (
        <Section key={index} header={`Блок ${index + 1}`}>
          <div className="form duties-edit">
            <Field label="Заголовок"><Input maxLength={120} value={draft.title} onChange={(event) => change(index, { title: event.target.value })} placeholder="Аварийно-диспетчерская служба" /></Field>
            <Field label="Обязанности и сроки" hint="Одна обязанность в строке"><Textarea maxLength={6000} rows={Math.min(10, Math.max(4, draft.text.split('\n').length + 1))} value={draft.text} onChange={(event) => change(index, { text: event.target.value })} /></Field>
            <Field label="Основание"><Input maxLength={200} value={draft.source} onChange={(event) => change(index, { source: event.target.value })} placeholder="ПП РФ № 416, п. 13" /></Field>
            <button type="button" className="link-button danger-link" onClick={() => setDrafts((current) => current.filter((_, at) => at !== index))}>Убрать блок</button>
          </div>
        </Section>
      ))}
      <Actions>
        {drafts.length < 15 ? <Button size="large" variant="secondary" stretched onClick={() => setDrafts((current) => [...current, { title: '', source: '', text: '' }])}>Добавить блок</Button> : null}
        <Button size="large" stretched loading={busy} disabled={busy || !blocks.length} onClick={() => void run(() => onSave(blocks), 'Обязанности сохранены')}>Сохранить</Button>
        {own ? <Button size="large" variant="secondary" stretched disabled={busy} onClick={async () => {
          if (!await confirm({ text: resetText, confirm: resetLabel })) return;
          await run(onReset, 'Вернули общий текст');
        }}>{resetLabel}</Button> : null}
      </Actions>
    </>
  );
}

export function DeskDutiesScreen() {
  const data = useLoad(() => api.desk.duties(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  return (
    <Page title="Обязанности УК" subtitle={data.data.own ? 'Жители видят вашу версию' : 'Жители видят общий текст по закону. Можно дополнить своими сроками из договора'}>
      <DutiesEditor initial={data.data.items} own={data.data.own} resetLabel="Вернуть общий текст" resetText="Вернуть общий текст обязанностей? Ваша версия удалится."
        onSave={async (items) => { await api.desk.saveDuties(items); await data.reload(); }}
        onReset={async () => { await api.desk.saveDuties(null); await data.reload(); }} />
    </Page>
  );
}

export function PlatformDutiesScreen() {
  const data = useLoad(() => api.platform.duties(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const changed = JSON.stringify(data.data.items) !== JSON.stringify(data.data.law);
  return (
    <Page title="Обязанности УК" subtitle="Общий текст для всех УК, у которых нет своей версии">
      <DutiesEditor initial={data.data.items} own={changed} resetLabel="Вернуть текст законов" resetText="Вернуть исходный текст по законам? Ваши правки общего текста удалятся."
        onSave={async (items) => { await api.platform.saveDuties(items); await data.reload(); }}
        onReset={async () => { await api.platform.saveDuties(null); await data.reload(); }} />
    </Page>
  );
}
