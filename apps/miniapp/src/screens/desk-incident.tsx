import { useState } from 'react';
import { Button, CellSimple, Input, Textarea, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type DeskIncidentDetail, type Status } from '../api';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad } from '../session';
import { Actions, Failure, Field, Loading, Page, Plate, Section, StatusChip, Sheet, PhotoStrip } from '../components/ui';
import { CategoryTile, IconTile } from '../components/icons';
import { ago, categoryLabels, formatDate, fromZoneInput, place, plural, priorityLabels, statusLabels, termLeft, toZoneInput } from '../labels';

// One incident on the company desk: who reported it, what the residents say,
// and the actions of the dispatcher. Every change is sent to all residents who
// reported the incident.

// "number:42" comes from a push in MAX ("desk_42"); the id is found by number.
async function load(reference: string) {
  if (reference.startsWith('number:')) {
    const [found] = await api.desk.incidents({ number: reference.slice('number:'.length) });
    if (!found) throw new Error('not found');
    return api.desk.incident(found.id);
  }
  return api.desk.incident(reference);
}

const nextActions: Record<Status, Array<{ status: Status; label: string; primary?: boolean }>> = {
  new: [{ status: 'acknowledged', label: 'Принять', primary: true }, { status: 'in_progress', label: 'Сразу в работу' }, { status: 'rejected', label: 'Отклонить' }],
  acknowledged: [{ status: 'in_progress', label: 'В работу', primary: true }, { status: 'resolved', label: 'Устранена' }, { status: 'rejected', label: 'Отклонить' }],
  in_progress: [{ status: 'resolved', label: 'Устранена', primary: true }, { status: 'acknowledged', label: 'Вернуть в «Принята»' }, { status: 'rejected', label: 'Отклонить' }],
  resolved: [{ status: 'in_progress', label: 'Вернуть в работу' }],
  rejected: [{ status: 'new', label: 'Вернуть в новые' }],
};

function latestDue() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 3);
  return date;
}

export function DeskIncidentScreen({ reference }: { reference: string }) {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const card = useLoad(() => load(reference), [reference]);
  const [pending, setPending] = useState<Status | 'comment' | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (card.error) return <Failure text={card.error} retry={card.reload} />;
  if (!card.data) return <Loading />;
  const incident: DeskIncidentDetail = card.data;
  const zone = incident.timeZone;
  const due = dueAt ?? (incident.dueAt ? toZoneInput(incident.dueAt, zone) : '');

  const save = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const status = pending === 'comment' ? undefined : pending;
      const dueValue = status === 'resolved' || status === 'rejected' ? null : due ? fromZoneInput(due, zone).toISOString() : null;
      await api.desk.updateIncident(incident.id, {
        version: incident.version,
        dueAt: dueValue,
        ...(status ? { status } : {}),
        ...(status === 'rejected' ? { rejectionReason: reason.trim() } : {}),
        ...(comment.trim().length >= 3 ? { publicComment: comment.trim() } : {}),
        ...(!status && comment.trim().length < 3 ? { delayReason: incident.delayReason } : {}),
      });
      bridge.haptic('success');
      showSnackbar({ text: `Сохранено. Жителям отправлено уведомление.` });
      setPending(null); setComment(''); setReason(''); setDueAt(null);
      await card.reload();
    } catch (error) {
      bridge.haptic('error');
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const updates = incident.events.filter((event) => ['incident_updated', 'incident_escalated', 'resident_reopened', 'incident_registered_by_phone'].includes(event.type));
  // A date the person typed by hand: not in the past, not later than 3 years,
  // a year of four digits.
  const dueProblem = !due ? null
    : !/^\d{4}-/.test(due) || Number.isNaN(fromZoneInput(due, zone).getTime()) ? 'Проверьте дату: год из четырёх цифр.'
    : fromZoneInput(due, zone).getTime() > latestDue().getTime() ? 'Срок не может быть дальше, чем через 3 года.'
    : null;
  const canSave = dueProblem ? false : pending === 'rejected' ? reason.trim().length >= 3 : pending === 'comment' ? comment.trim().length >= 3 || due !== (incident.dueAt ? toZoneInput(incident.dueAt, zone) : '') : true;

  return (
    <Page title={incident.title} subtitle={<span className="cell-overline"><Plate>№ {incident.number}</Plate><StatusChip status={incident.status} />{incident.priority === 'high' || incident.priority === 'emergency' ? <span className={`tag tag-${incident.priority}`}>{priorityLabels[incident.priority]}</span> : null}</span>}>
      <Section>
        <CellSimple before={<CategoryTile category={incident.category} />} title={categoryLabels[incident.category]} subtitle={`${incident.building.address}, ${place(incident)}`} />
        <CellSimple before={<IconTile name="people" color="#5856d6" size={40} />} title={`${incident.reports.length} ${plural(incident.reports.length, 'житель сообщил', 'жителя сообщили', 'жителей сообщили')}`} subtitle={`Первое обращение ${ago(incident.createdAt)}`} />
        {incident.dueAt ? <CellSimple before={<IconTile name="bell" color="#ff9500" size={40} />} title="Плановый срок" subtitle={formatDate(incident.dueAt, zone)} /> : null}
        {incident.status !== 'resolved' && incident.status !== 'rejected' ? <CellSimple before={<IconTile name="shield" color={new Date(incident.legalTerm.dueAt).getTime() < Date.now() ? '#ff3b30' : '#8a8f98'} size={40} />} title={`Срок по закону: ${termLeft(incident.legalTerm.dueAt)}`} subtitle={<span className="address-details"><span>{incident.legalTerm.title}{incident.legalTerm.firstStep ? `; ${incident.legalTerm.firstStep}` : ''}</span><span>{incident.legalTerm.source}</span></span>} /> : null}
      </Section>

      <Actions>
        {nextActions[incident.status].map((action) => (
          <Button key={action.status} size="large" variant={action.primary ? 'primary' : 'secondary'} stretched onClick={() => setPending(action.status)}>{action.label}</Button>
        ))}
        <Button size="large" variant="ghost" stretched onClick={() => setPending('comment')}>Сообщение жителям или срок</Button>
      </Actions>

      {incident.source === 'phone' ? (
        <Section header="Принята по телефону">
          <CellSimple title={<span className="pre-wrap">{incident.callNote ?? incident.title}</span>} subtitle={[incident.callerName, incident.callerPhone].filter(Boolean).join(', ') || 'Звонивший не представился'} />
        </Section>
      ) : null}
      {incident.acceptance ? (
        <Section header="Приёмка работы">
          <CellSimple title={incident.acceptance.state === 'confirmed' ? 'Принята: житель подтвердил' : incident.acceptance.state === 'silent' ? 'Принята: жители не ответили за 14 дней' : 'Ждём ответа жителей'}
            subtitle={incident.acceptance.state === 'waiting' ? `До ${formatDate(incident.acceptance.until, zone)}. Без ответа работа будет считаться принятой.` : undefined} />
        </Section>
      ) : null}
      {incident.feedback.length ? (
        <Section header={`Ответ жителей: решено ${incident.feedbackSummary.confirmed}, не решено ${incident.feedbackSummary.returned}${incident.feedbackSummary.ratingAverage ? `, оценка ${incident.feedbackSummary.ratingAverage}` : ''}`}>
          {incident.feedback.map((item) => (
            <CellSimple key={item.id} overline={`${item.apartment ? `Кв. ${item.apartment.number}` : 'Житель'}, ${ago(item.updatedAt)}`}
              title={item.resolved ? `Решено${item.rating ? ` · ${'★'.repeat(item.rating)}` : ''}` : 'Не решено — вернул в работу'}
              {...(item.comment ? { subtitle: <span className="pre-wrap">{item.comment}</span> } : {})} />
          ))}
        </Section>
      ) : null}
      <Section header="Что пишут жители">
        {incident.reports.length === 0 ? <CellSimple subtitle="Жителей этой квартиры пока нет в сервисе: о ходе работ сообщите звонившему сами." /> : null}
        {incident.reports.map((report) => (
          <CellSimple key={report.id} overline={`${report.apartment ? `Кв. ${report.apartment.number}` : 'Житель'}, ${ago(report.createdAt)}`} title={<span className="pre-wrap">{report.description || 'Присоединился: у него та же проблема'}</span>} />
        ))}
      </Section>
      {incident.photos.length ? <PhotoStrip photos={incident.photos.map((photo) => photo.url).filter((url): url is string => Boolean(url))} /> : null}
      {incident.comments.length ? (
        <Section header="Обсуждение соседей">
          {incident.comments.map((item) => <CellSimple key={item.id} overline={`${item.apartment ? `Кв. ${item.apartment.number}` : 'Житель'}, ${ago(item.createdAt)}`} title={<span className="pre-wrap">{item.text}</span>} />)}
        </Section>
      ) : null}
      {updates.length ? (
        <Section header="История">
          {updates.slice().reverse().map((event) => {
            const payload = event.payload as { newStatus?: Status; publicComment?: string | null; reports?: number; priority?: string };
            if (event.type === 'resident_reopened') return <CellSimple key={event.id} overline={formatDate(event.createdAt, zone)} title="Житель вернул в работу" subtitle={(event.payload as { comment?: string | null }).comment ?? 'Проблема не решена'} />;
            if (event.type === 'incident_registered_by_phone') return <CellSimple key={event.id} overline={formatDate(event.createdAt, zone)} title="Принята по телефону" />;
            return event.type === 'incident_escalated'
              ? <CellSimple key={event.id} overline={formatDate(event.createdAt, zone)} title={`Уже ${payload.reports} ${plural(payload.reports ?? 0, 'житель', 'жителя', 'жителей')}`} subtitle="Приоритет поднят автоматически" />
              : <CellSimple key={event.id} overline={formatDate(event.createdAt, zone)} title={payload.newStatus ? statusLabels[payload.newStatus] : 'Обновление'} subtitle={payload.publicComment ?? undefined} />;
          })}
        </Section>
      ) : null}

      <Sheet open={pending !== null} onClose={() => { setPending(null); setComment(''); setReason(''); setDueAt(null); }} title={pending === 'comment' ? 'Сообщение жителям' : pending ? `Статус: ${statusLabels[pending]}` : ''}>
        <div className="sheet form">
          {pending === 'rejected' ? (
            <Field label="Причина отклонения" hint="Жители увидят её в уведомлении">
              <Textarea maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: оборудование принадлежит магазину, передали владельцу" />
            </Field>
          ) : null}
          {pending !== 'resolved' && pending !== 'rejected' ? (
            <Field label="Плановый срок" hint={dueProblem ?? 'Можно не указывать. Если указан, жители видят срок в карточке заявки. Не позже чем через 3 года.'}>
              <Input type="datetime-local" value={due} min={toZoneInput(new Date(), zone)} max={toZoneInput(latestDue(), zone)} onChange={(event) => setDueAt(event.target.value)} />
            </Field>
          ) : null}
          {pending !== 'resolved' ? (
            <Field label="Комментарий для жителей" hint="Необязательно. Придёт всем, кто сообщил о проблеме">
              <Textarea rows={3} value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Например: бригада выехала, ориентировочно к 18:00" />
            </Field>
          ) : <Typography.Body variant="small" className="muted">Все {incident.reports.length} {plural(incident.reports.length, 'житель получит', 'жителя получат', 'жителей получат')} уведомление, что проблема устранена.</Typography.Body>}
          <Button size="large" stretched loading={busy} disabled={busy || !canSave} onClick={() => void save()}>Сохранить и уведомить</Button>
        </div>
      </Sheet>
      <Actions><Button size="medium" variant="ghost" onClick={() => navigation.push({ name: 'desk-broadcast' })}>Объявление всему дому</Button></Actions>
    </Page>
  );
}
