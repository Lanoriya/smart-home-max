import { useEffect, useState } from 'react';
import { Button, CellSimple, Segmented, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type IncidentDetail, type Status } from '../api';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad, useSession } from '../session';
import { Actions, Empty, Failure, Field, IncidentCell, Loading, Page, Plate, Section, Sheet, StatusChip, Chips, PhotoStrip } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { useUnread } from '../unread';
import { CategoryTile, IconTile } from '../components/icons';
import { ago, categoryLabels, formatDate, place, plural, priorityLabels, statusLabels, termLeft } from '../labels';

type Scope = 'building' | 'mine' | 'archive';

const emptyTexts: Record<Scope, { icon: 'shield' | 'inbox' | 'archive'; title: string; text: string }> = {
  building: { icon: 'shield', title: 'В доме всё спокойно', text: 'Открытых общих проблем нет.' },
  mine: { icon: 'inbox', title: 'Открытых заявок нет', text: 'Нажмите «+ Новая», чтобы сообщить о проблеме.' },
  archive: { icon: 'archive', title: 'Архив пуст', text: 'Сюда попадают решённые, отклонённые и отменённые заявки.' },
};

export function IncidentsScreen() {
  const { me } = useSession();
  // Without a confirmed apartment there are no incidents to show: even old
  // ones belong to an address the person has left.
  return me.residence ? <IncidentList /> : <NoResidence />;
}

function NoResidence() {
  const navigation = useNavigation();
  return (
    <Page title="Заявки">
      <Empty icon="building" title="Сначала выберите дом" text="Заявки появятся, когда вы найдёте свой дом на карте и подтвердите квартиру."
        action={<Button size="medium" onClick={() => navigation.switchTab('map')}>Открыть карту</Button>} />
    </Page>
  );
}

type Order = 'fresh' | 'urgent' | 'popular';
const urgencyRank = { emergency: 0, high: 1, normal: 2, low: 3 } as const;

function IncidentList() {
  const navigation = useNavigation();
  const [scope, setScope] = useState<Scope>('building');
  const [order, setOrder] = useState<Order>('fresh');
  const [kind, setKind] = useState<'all' | 'apartment' | 'house'>('all');
  const list = useLoad(() => api.incidents(scope), [scope]);
  // A new update or a neighbour's report shows up without reopening the app.
  const unread = useUnread();
  useEffect(() => { if (unread.incidents > 0) void list.reload(); }, [unread.incidents]); // eslint-disable-line react-hooks/exhaustive-deps
  // The same list in the chosen order: fresh first, urgent first or the ones
  // the most neighbours reported first.
  const items = [...(list.data ?? [])]
    .filter((incident) => scope === 'building' || kind === 'all' || (kind === 'apartment') === (incident.locationZone === 'apartment'))
    .sort((left, right) => (
    order === 'urgent' ? urgencyRank[left.priority] - urgencyRank[right.priority] || right.updatedAt.localeCompare(left.updatedAt)
      : order === 'popular' ? right.reportsCount - left.reportsCount || right.updatedAt.localeCompare(left.updatedAt)
        : right.updatedAt.localeCompare(left.updatedAt)
  ));
  const empty = emptyTexts[scope];

  return (
    <Page title="Заявки" after={<Button size="small" onClick={() => navigation.push({ name: 'new-incident' })}>+ Новая</Button>}>
      <Segmented items={[{ id: 'building', title: 'В доме' }, { id: 'mine', title: 'Мои' }, { id: 'archive', title: 'Архив' }]} activeItem={scope} onClick={(id) => setScope(id as Scope)} />
      {scope !== 'building' ? <Chips label="Чьи" items={[{ id: 'all', title: 'Все' }, { id: 'apartment', title: 'Моя квартира' }, { id: 'house', title: 'Дом' }]} active={kind} onChange={setKind} /> : null}
      <Chips label="Порядок" items={[{ id: 'fresh', title: 'Сначала свежие' }, { id: 'urgent', title: 'Сначала срочные' }, ...(scope === 'building' ? [{ id: 'popular' as const, title: 'Больше всего соседей' }] : [])]} active={scope !== 'building' && order === 'popular' ? 'fresh' : order} onChange={setOrder} />
      {list.error ? <Failure text={list.error} retry={list.reload} /> : list.loading && !list.data ? <Loading /> : items.length ? (
        <Section>
          {items.map((incident) => (
            <IncidentCell key={incident.id} {...incident} when={incident.updatedAt} {...(scope !== 'building' ? { addressLine: incident.address } : {})} onClick={() => navigation.push({ name: 'incident', ref: incident.id })} />
          ))}
        </Section>
      ) : <Empty icon={empty.icon} title={empty.title} text={empty.text} />}
    </Page>
  );
}

// After "resolved": the resident confirms the result and rates it, or
// returns the incident to work.
function Feedback({ incident, busy, onConfirm, onReturn }: { incident: IncidentDetail; busy: string | null; onConfirm: (rating?: number) => void; onReturn: () => void }) {
  const { answer, canAnswer, until } = incident.feedback;
  if (answer && !answer.resolved) {
    return <Section header="Ваш ответ"><CellSimple title="Не решено" subtitle="Вы вернули заявку в работу. Новый статус придёт в чат с ботом." /></Section>;
  }
  if (answer) {
    return (
      <Section header="Ваш ответ">
        <CellSimple title="Проблема решена" subtitle={answer.rating ? `Ваша оценка работы УК: ${answer.rating} из 5` : 'Оцените работу УК — это поможет ей работать лучше'} />
        {canAnswer ? (
          <div className="feedback-box">
            <Stars value={answer.rating} disabled={busy === 'feedback'} onPick={onConfirm} />
            <Button size="small" variant="ghost" onClick={onReturn}>Всё-таки не решено</Button>
          </div>
        ) : null}
      </Section>
    );
  }
  return (
    <Section header="Проблема действительно решена?">
      <CellSimple subtitle={`УК отметила заявку как устранённую. Если это не так, верните её в работу${until ? ` — до ${formatDate(until, incident.timeZone)}` : ''}.`} />
      <div className="feedback-box feedback-actions">
        <Button size="medium" stretched loading={busy === 'feedback'} onClick={() => onConfirm()}>Да, решено</Button>
        <Button size="medium" stretched variant="secondary" onClick={onReturn}>Не решено</Button>
      </div>
    </Section>
  );
}

function Stars({ value, disabled, onPick }: { value: number | null; disabled: boolean; onPick: (rating: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Оценка работы УК">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button key={rating} type="button" role="radio" aria-checked={value === rating} aria-label={`${rating} из 5`} disabled={disabled}
          className={value !== null && rating <= value ? 'star star-on' : 'star'} onClick={() => onPick(rating)}>★</button>
      ))}
    </div>
  );
}

const progressSteps: Status[] = ['new', 'acknowledged', 'in_progress', 'resolved'];

function Progress({ status }: { status: Status }) {
  if (status === 'rejected') return <div className="progress progress-rejected">Заявка отклонена</div>;
  const reached = progressSteps.indexOf(status);
  return (
    <ol className="progress" aria-label={`Статус: ${statusLabels[status]}`}>
      {progressSteps.map((step, index) => (
        <li key={step} className={index <= reached ? 'progress-done' : ''} aria-current={index === reached ? 'step' : undefined}>
          <span className="progress-dot" />
          <span className="progress-label">{statusLabels[step]}</span>
        </li>
      ))}
    </ol>
  );
}

export function IncidentScreen({ reference }: { reference: string | number }) {
  const { me } = useSession();
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const card = useLoad(() => api.incident(reference), [reference]);
  const confirm = useConfirm();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // "Not solved": what is still wrong, optional, for the dispatcher.
  const [returning, setReturning] = useState(false);
  const [problem, setProblem] = useState('');

  if (card.error) return <Failure text={card.error} retry={card.reload} />;
  if (!card.data) return <Loading />;
  const incident: IncidentDetail = card.data;

  const act = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await action();
      bridge.haptic('success');
      showSnackbar({ text: success });
      await card.reload();
    } catch (error) {
      bridge.haptic('error');
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  // Neighbours who have not reported yet are invited to join the same incident.
  const shareLink = me.botUsername ? `https://max.ru/${me.botUsername}?startapp=incident_${incident.number}` : undefined;
  const share = async () => {
    const result = await bridge.share(`Соседи, в доме проблема: «${incident.title}». Если у вас то же самое — присоединяйтесь к заявке № ${incident.number}, так УК быстрее отреагирует.`, shareLink);
    if (result === 'copied') showSnackbar({ text: 'Текст скопирован — отправьте его в чат дома.' });
  };

  return (
    <Page title={incident.title} subtitle={<span className="cell-overline"><Plate>№ {incident.number}</Plate><StatusChip status={incident.status} />{incident.priority === 'high' || incident.priority === 'emergency' ? <span className={`tag tag-${incident.priority}`}>{priorityLabels[incident.priority]}</span> : null}</span>}>
      <Progress status={incident.status} />
      <Section>
        <CellSimple before={<CategoryTile category={incident.category} />} title={categoryLabels[incident.category]} subtitle={`${place(incident)}, ${incident.address}`} />
        <CellSimple before={<IconTile name="people" color="#5856d6" size={40} />} title={`${incident.reportsCount} ${plural(incident.reportsCount, 'житель сообщил', 'жителя сообщили', 'жителей сообщили')}`} subtitle={`Создана ${formatDate(incident.createdAt, incident.timeZone)}`} />
        {incident.dueAt && incident.status !== 'resolved' && incident.status !== 'rejected' ? <CellSimple before={<IconTile name="bell" color="#ff9500" size={40} />} title="Плановый срок" subtitle={formatDate(incident.dueAt, incident.timeZone)} /> : null}
        {incident.status !== 'resolved' && incident.status !== 'rejected' ? <CellSimple before={<IconTile name="shield" color={new Date(incident.legalTerm.dueAt).getTime() < Date.now() ? '#ff3b30' : '#8a8f98'} size={40} />} title={`Срок по закону: ${termLeft(incident.legalTerm.dueAt)}`} subtitle={<span className="address-details"><span>{incident.legalTerm.title}{incident.legalTerm.firstStep ? `; ${incident.legalTerm.firstStep}` : ''}</span><span>{incident.legalTerm.source}</span></span>} /> : null}
        {incident.delayReason ? <CellSimple title="Причина переноса" subtitle={incident.delayReason} /> : null}
        {incident.rejectionReason ? <CellSimple title="Причина отклонения" subtitle={incident.rejectionReason} /> : null}
        {incident.myDescription ? <CellSimple title="Ваше описание" subtitle={incident.myDescription} /> : null}
      </Section>

      {incident.feedback.canAnswer || incident.feedback.answer ? (
        <Feedback incident={incident} busy={busy}
          onConfirm={(rating) => void act('feedback', () => api.feedback(incident.id, rating ? { resolved: true, rating } : { resolved: true }), rating ? 'Спасибо за оценку!' : 'Спасибо, что подтвердили!')}
          onReturn={() => setReturning(true)} />
      ) : null}

      <Sheet open={returning} onClose={() => { setReturning(false); setProblem(''); }} title="Проблема не решена">
        <div className="sheet form">
          <Field label="Что осталось не так" hint="Необязательно. Увидит только диспетчер УК">
            <Textarea rows={3} maxLength={500} value={problem} onChange={(event) => setProblem(event.target.value)} placeholder="Например: батарея снова холодная с утра" />
          </Field>
          <Button size="large" stretched variant="destructive" loading={busy === 'reopen'} onClick={() => void act('reopen', () => api.feedback(incident.id, problem.trim() ? { resolved: false, comment: problem.trim() } : { resolved: false }), 'Заявка вернулась в работу. УК получила уведомление.').then(() => { setReturning(false); setProblem(''); })}>Вернуть заявку в работу</Button>
        </div>
      </Sheet>

      <Actions>
        {incident.canJoin ? (
          <Button size="large" stretched loading={busy === 'join'} onClick={() => void act('join', () => api.joinIncident(incident.id), 'Вы присоединились. Уведомления о статусе придут в чат с ботом.')}>
            У меня то же самое
          </Button>
        ) : null}
        {incident.locationZone !== 'apartment' && incident.status !== 'resolved' && incident.status !== 'rejected' ? (
          <Button size="large" variant="secondary" stretched onClick={() => void share()}>Позвать соседей</Button>
        ) : null}
      </Actions>

      {incident.timeline.length ? (
        <Section header="Что делает УК">
          {incident.timeline.slice().reverse().map((entry, index) => (
            <CellSimple
              key={`${entry.at}-${index}`}
              overline={formatDate(entry.at, incident.timeZone)}
              title={entry.status ? statusLabels[entry.status] : 'Обновление'}
              subtitle={[entry.comment, entry.delayReason ? `Перенос: ${entry.delayReason}` : null, entry.dueAt ? `Срок: ${formatDate(entry.dueAt, incident.timeZone)}` : null].filter(Boolean).join(', ') || undefined}
            />
          ))}
        </Section>
      ) : (
        <Section header="Что делает УК"><CellSimple title="Заявка передана в управляющую компанию" subtitle="Как только её примут, статус обновится здесь и в чате с ботом." /></Section>
      )}

      {incident.photos.length ? (
        <PhotoStrip photos={incident.photos.map((photo) => photo.url)} />
      ) : null}

      {incident.locationZone !== 'apartment' ? (
        <Section header={`Обсуждение соседей${incident.comments.length ? `, ${incident.comments.length}` : ''}`}>
          {incident.comments.map((item) => (
            <CellSimple key={item.id} overline={`${item.mine ? 'Вы' : item.apartmentNumber ? `Кв. ${item.apartmentNumber}` : 'Житель'}, ${ago(item.createdAt)}`} title={<span className="pre-wrap">{item.text}</span>}
              {...(item.mine ? { after: <Button size="small" variant="secondary" onClick={async () => {
                if (!await confirm({ text: 'Удалить ваш комментарий? Соседи и УК перестанут его видеть.', confirm: 'Удалить', destructive: true })) return;
                void act('comment-delete', () => api.deleteComment(incident.id, item.id), 'Комментарий удалён');
              }}>Удалить</Button> } : {})} />
          ))}
          {!incident.comments.length ? <CellSimple subtitle="Пока нет комментариев." /> : null}
        </Section>
      ) : null}
      {incident.canComment && me.residence ? (
        <div className="form">
          <Textarea placeholder="Комментарий для соседей и УК" value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} />
          <Button size="medium" disabled={comment.trim().length < 2} loading={busy === 'comment'} onClick={() => void act('comment', async () => { await api.comment(incident.id, comment.trim()); setComment(''); }, 'Комментарий добавлен')}>Отправить</Button>
        </div>
      ) : null}

      {incident.canCancel ? (
        <Actions>
          <Button variant="ghost" size="medium" loading={busy === 'cancel'} onClick={async () => {
            // The resident's comments stay unless they tick it themselves.
            const withComments = incident.comments.some((item) => item.mine) ? { option: 'Удалить и мои комментарии к этой заявке' } : {};
            const answer = await confirm(incident.reportsCount > 1
              ? { text: 'Отменить ваше участие? Заявка останется у соседей.', confirm: 'Да, отменить', destructive: true, ...withComments }
              : { text: 'Отменить заявку? УК перестанет её видеть в очереди.', confirm: 'Отменить заявку', cancel: 'Оставить', destructive: true, ...withComments });
            if (!answer) return;
            void act('cancel', () => api.cancelIncident(incident.id, answer.option), 'Ваше обращение отменено').then(() => navigation.back());
          }}>{incident.reportsCount > 1 ? 'Больше не актуально для меня' : 'Отменить заявку'}</Button>
        </Actions>
      ) : null}
    </Page>
  );
}
