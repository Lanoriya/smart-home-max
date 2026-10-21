import { useEffect, useState } from 'react';
import { Button, CellSimple, Input, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type EmergencyService, type QuickDialItem } from '../api';
import { useLoad } from '../session';
import { IconTile } from '../components/icons';
import { Actions, Failure, Field, Loading, Page, Section, Sheet } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { formatPhone } from '../labels';

// The numbers residents see in «Службы»: the quick dial row and the
// emergency services of the company's houses.
export function DeskServicesScreen() {
  const data = useLoad(() => api.desk.services(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  return (
    <Page title="Номера служб" subtitle="Жители видят их во вкладке «Службы» и в боте">
      <QuickDialEditor initial={data.data.quickDial} custom={data.data.customQuickDial} onSaved={data.reload} />
      <ServicesEditor items={data.data.items} onChanged={data.reload} />
    </Page>
  );
}

function QuickDialEditor({ initial, custom, onSaved }: { initial: QuickDialItem[]; custom: boolean; onSaved: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setItems(initial), [initial]);
  const change = (index: number, patch: Partial<QuickDialItem>) => setItems((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const valid = items.every((item) => /^\+?[\d\s()-]{2,20}$/.test(item.number.trim()) && item.title.trim().length >= 2);
  const save = async (next: QuickDialItem[] | null) => {
    setBusy(true);
    try {
      await api.desk.saveQuickDial(next);
      showSnackbar({ text: next ? 'Быстрый набор сохранён' : 'Вернули стандартные номера' });
      onSaved();
    } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setBusy(false); }
  };
  return (
    <Section header="Быстрый набор">
      <div className="form dial-editor">
        <span className="field-hint">{custom ? 'Жители видят список вашей УК.' : 'Сейчас жители видят стандартные номера: они работают с любого телефона. Можно поменять, например добавить местную газовую службу.'}</span>
        {items.map((item, index) => (
          <div key={index} className="dial-row">
            <Input maxLength={20} className="dial-number" inputMode="tel" value={item.number} onChange={(event) => change(index, { number: event.target.value })} placeholder="112" aria-label="Номер" />
            <Input maxLength={40} value={item.title} onChange={(event) => change(index, { title: event.target.value })} placeholder="Название" aria-label="Название" />
            <button type="button" className="dial-remove" aria-label={`Убрать ${item.number}`} onClick={() => setItems((current) => current.filter((_, at) => at !== index))}>×</button>
          </div>
        ))}
        {items.length < 8 ? <button type="button" className="link-button" onClick={() => setItems((current) => [...current, { number: '', title: '' }])}>Добавить номер</button> : null}
        <Button size="large" stretched loading={busy} disabled={busy || !items.length || !valid} onClick={() => void save(items.map((item) => ({ number: item.number.trim(), title: item.title.trim() })))}>Сохранить быстрый набор</Button>
        {custom ? <Button size="large" variant="secondary" stretched disabled={busy} onClick={() => void save(null)}>Вернуть стандартные номера</Button> : null}
      </div>
    </Section>
  );
}

type Draft = { id: string | null; name: string; phone: string; description: string };

function ServicesEditor({ items, onChanged }: { items: EmergencyService[]; onChanged: () => void }) {
  const { showSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (next: Draft) => { setError(null); setDraft(next); };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const body = { name: draft.name.trim(), phone: formatPhone(draft.phone.trim()) || draft.phone.trim(), description: draft.description.trim() };
    try {
      if (draft.id) await api.desk.updateService(draft.id, body); else await api.desk.addService(body);
      setDraft(null);
      showSnackbar({ text: draft.id ? 'Служба изменена' : 'Служба добавлена' });
      onChanged();
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  const remove = async (service: EmergencyService) => {
    if (!await confirm({ text: `Убрать «${service.name}» из списка жителей?`, confirm: 'Убрать', destructive: true })) return;
    try { await api.desk.deleteService(service.id); setDraft(null); showSnackbar({ text: 'Служба убрана' }); onChanged(); } catch (failure) { showSnackbar({ text: errorText(failure) }); }
  };
  return (
    <>
      <Section header="Аварийные службы">
        {items.length ? items.map((service) => (
          <CellSimple key={service.id} as="button" onClick={() => open({ id: service.id, name: service.name, phone: service.phone, description: service.description })} showChevron
            before={<IconTile name="siren" color="#ff3b30" />} title={service.name}
            subtitle={<span className="address-details"><span className="service-phone">{service.phone}</span>{service.description ? <span>{service.description}</span> : null}</span>} />
        )) : <CellSimple subtitle="Служб пока нет. Добавьте аварийную, лифтовую, домофон — то, что нужно вашим домам." />}
      </Section>
      <Actions>
        <Button size="large" stretched onClick={() => open({ id: null, name: '', phone: '', description: '' })}>Добавить службу</Button>
      </Actions>
      <Sheet open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? 'Служба' : 'Новая служба'}>
        {draft ? (
          <div className="form">
            <Field label="Название"><Input maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Аварийно-диспетчерская служба" /></Field>
            <Field label="Телефон"><Input maxLength={40} inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} onBlur={() => setDraft((current) => (current ? { ...current, phone: formatPhone(current.phone) || current.phone } : current))} placeholder="+7 (900) 000-00-00" /></Field>
            <Field label="Когда звонить"><Textarea maxLength={400} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Прорыв труб, нет света в подъезде — круглосуточно" /></Field>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <Button size="large" stretched loading={busy} disabled={busy || draft.name.trim().length < 2 || draft.phone.trim().length < 3 || draft.description.trim().length < 2} onClick={() => void save()}>{draft.id ? 'Сохранить' : 'Добавить'}</Button>
            {draft.id ? <Button size="large" variant="destructive" stretched disabled={busy} onClick={() => void remove(items.find((item) => item.id === draft.id)!)}>Убрать службу</Button> : null}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
