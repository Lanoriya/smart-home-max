import { useMemo, useState } from 'react';
import { Button, CellSimple, Input, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText } from '../api';
import { bridge } from '../bridge';
import { useLoad } from '../session';
import { useConfirm } from '../components/confirm';
import { IconTile } from '../components/icons';
import { Empty, Failure, Field, Loading, Page, Section } from '../components/ui';
import { plural, zoneOffset, zoned, zonedToUtc } from '../labels';

// Reception of citizens: a resident takes a free window of the company and
// names the topic; the company opens windows for a day by hours and a step.

// Days and hours of the reception are those of the city of the company.
const day = (value: string | Date, zone: string) => zoned(value, zone, { weekday: 'long', day: 'numeric', month: 'long' });
const time = (value: string | Date, zone: string) => zoned(value, zone, { hour: '2-digit', minute: '2-digit' });

function byDay<T extends { startsAt: string }>(items: T[], zone: string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(day(item.startsAt, zone), [...(groups.get(day(item.startsAt, zone)) ?? []), item]);
  return [...groups.entries()];
}

export function AppointmentsScreen() {
  const data = useLoad(() => api.appointments(), []);
  const confirm = useConfirm();
  const { showSnackbar } = useSnackbar();
  const [chosen, setChosen] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const { company, free, mine, limit, timeZone: zone } = data.data;
  if (!company) return <Page title="Запись на приём"><Empty icon="building" title="Сначала подключитесь к дому" text="Запись идёт к управляющей компании вашего дома." /></Page>;
  const slot = free.find((item) => item.id === chosen) ?? null;
  const book = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      await api.book(slot.id, topic.trim());
      bridge.haptic('success');
      showSnackbar({ text: `Вы записаны: ${day(slot.startsAt, zone)}, ${time(slot.startsAt, zone)}` });
      setChosen(null); setTopic('');
      await data.reload();
    } catch (error) { showSnackbar({ text: errorText(error) }); await data.reload(); } finally { setBusy(false); }
  };
  return (
    <Page title="Запись на приём" subtitle={`${company.name}. Время местное (${zoneOffset(zone)})`}>
      {company.receptionHours || company.address ? <div className="info-card"><span className="info-card-text multiline">{[company.receptionHours ? `Приём: ${company.receptionHours}` : null, company.address ? `Офис: ${company.address}` : null].filter(Boolean).join('\n')}</span></div> : null}
      {mine.length ? (
        <Section header="Мои записи">
          {mine.map((item) => (
            <CellSimple key={item.id} before={<IconTile name="calendar" color="#34c759" />} title={`${day(item.startsAt, zone)}, ${time(item.startsAt, zone)}`} subtitle={item.topic ? <span className={openTopic === item.id ? undefined : 'clamp-3'} onClick={() => setOpenTopic(openTopic === item.id ? null : item.id)}>{item.topic}</span> : undefined}
              after={<Button size="small" variant="secondary" onClick={async () => {
                if (!await confirm({ text: 'Отменить запись? Окно станет свободным для других жителей.', confirm: 'Отменить запись', destructive: true })) return;
                try { await api.cancelBooking(item.id); showSnackbar({ text: 'Запись отменена' }); await data.reload(); } catch (error) { showSnackbar({ text: errorText(error) }); }
              }}>Отменить</Button>} />
          ))}
        </Section>
      ) : null}
      {mine.length >= limit ? <p className="field-hint duties-footnote">Можно держать не больше {limit} {plural(limit, 'записи', 'записей', 'записей')} одновременно.</p> : free.length ? (
        <>
          {byDay(free, zone).map(([title, slots]) => (
            <section key={title} className="section">
              <h2 className="section-header">{title}</h2>
              <div className="slot-grid">
                {slots.map((item) => <button key={item.id} type="button" className={`slot${item.id === chosen ? ' slot-chosen' : ''}`} aria-pressed={item.id === chosen} onClick={() => setChosen(item.id)}>{time(item.startsAt, zone)}</button>)}
              </div>
            </section>
          ))}
          {slot ? (
            <div className="form slot-form">
              <Field label={`${day(slot.startsAt, zone)}, ${time(slot.startsAt, zone)}, ${slot.durationMinutes} мин`} hint="Коротко: с каким вопросом придёте. Сотрудник УК подготовится заранее">
                <Textarea maxLength={300} value={topic} onChange={(event) => setTopic(event.target.value)} rows={3} placeholder="Перерасчёт за отопление" />
              </Field>
              <Button size="large" stretched loading={busy} disabled={busy || topic.trim().length < 3} onClick={() => void book()}>Записаться</Button>
            </div>
          ) : <p className="field-hint duties-footnote">Выберите время — затем укажите тему визита.</p>}
        </>
      ) : <Empty icon="calendar" title="Свободных окон нет" text={`УК пока не открыла запись. Позвонить: ${company.phone}`} />}
    </Page>
  );
}

// ---------- the company ----------

export function DeskAppointmentsScreen() {
  const data = useLoad(() => api.desk.appointments(), []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const confirm = useConfirm();
  const { showSnackbar } = useSnackbar();
  const tomorrow = useMemo(() => { const date = new Date(Date.now() + 24 * 3_600_000); return date.toISOString().slice(0, 10); }, []);
  const [date, setDate] = useState(tomorrow);
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('13:00');
  const [step, setStep] = useState('20');
  const [busy, setBusy] = useState(false);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const zone = data.data.timeZone;
  // The hours are those of the city of the company, not of this phone.
  const starts = (() => {
    const result: string[] = [];
    const begin = zonedToUtc(date, from, zone).getTime();
    const end = zonedToUtc(date, to, zone).getTime();
    for (let at = begin; Number(step) >= 5 && at + Number(step) * 60_000 <= end && result.length < 100; at += Number(step) * 60_000) result.push(new Date(at).toISOString());
    return result;
  })();
  const open = async () => {
    setBusy(true);
    try {
      const result = await api.desk.createSlots(starts, Number(step));
      showSnackbar({ text: `Открыто окон: ${result.created}${result.skipped ? `, уже были: ${result.skipped}` : ''}` });
      await data.reload();
    } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setBusy(false); }
  };
  const items = data.data.items;
  const booked = items.filter((item) => item.booked).length;
  return (
    <Page title="Приём граждан" subtitle={`Окон впереди: ${items.length}, занято: ${booked}. Время местное (${zoneOffset(zone)})`}>
      <Section header="Открыть окна">
        <div className="form slot-form">
          <Field label="День"><Input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></Field>
          <div className="form-row">
            <Field label="С"><Input type="time" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="До"><Input type="time" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
            <Field label="Шаг, мин"><Input inputMode="numeric" value={step} onChange={(event) => setStep(event.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
          </div>
          <Button size="large" stretched loading={busy} disabled={busy || !starts.length || Number(step) < 5} onClick={() => void open()}>{starts.length ? `Открыть ${starts.length} ${plural(starts.length, 'окно', 'окна', 'окон')}` : 'Проверьте время и шаг'}</Button>
        </div>
      </Section>
      {items.length ? byDay(items, zone).map(([title, slots]) => (
        <Section key={title} header={title}>
          {slots.map((item) => (
            <CellSimple key={item.id} {...(item.topic ? { as: 'button' as const, onClick: () => setExpanded(expanded === item.id ? null : item.id) } : {})} className={expanded === item.id ? 'cell-open' : 'cell-clamped'} before={<IconTile name="calendar" color={item.booked ? '#34c759' : '#8a8f98'} />}
              title={`${time(item.startsAt, zone)} · ${item.booked ? 'записан житель' : 'свободно'}`}
              subtitle={item.resident ? <span className="address-details">{[item.resident.address, [item.resident.name, item.resident.phone].filter(Boolean).join(', '), item.topic ? `Тема: ${item.topic}` : null].filter(Boolean).map((line) => <span key={line}>{line}</span>)}</span> : undefined}
              after={<Button size="small" variant="secondary" onClick={async () => {
                if (!await confirm({ text: item.booked ? 'Отменить приём? Житель получит сообщение об отмене.' : 'Убрать свободное окно?', confirm: item.booked ? 'Отменить приём' : 'Убрать', destructive: true })) return;
                try { await api.desk.deleteSlot(item.id); await data.reload(); } catch (error) { showSnackbar({ text: errorText(error) }); }
              }}>{item.booked ? 'Отменить' : 'Убрать'}</Button>} />
          ))}
        </Section>
      )) : <Empty icon="calendar" title="Окон пока нет" text="Откройте окна на день — жители увидят их в «Моя УК» и на главной." />}
    </Page>
  );
}
