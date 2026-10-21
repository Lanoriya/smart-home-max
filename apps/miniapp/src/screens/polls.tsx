import { useState } from 'react';
import { Button, Input, Textarea, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type Poll } from '../api';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { useLoad } from '../session';
import { useUnread } from '../unread';
import { useConfirm } from '../components/confirm';
import { Actions, Empty, Failure, Field, Loading, Page } from '../components/ui';
import { plural, spellDuration, zoneOffset, zoned } from '../labels';

// Polls of the management company. A resident answers for the apartment and
// sees the results after voting or when the poll is over; in a public poll
// also which apartments chose what.

function until(poll: Poll) {
  const local = (value: string) => `${zoned(value, poll.timeZone)} по местному времени (${poll.zoneLabel})`;
  if (poll.closedAt) return `завершён ${local(poll.closedAt)}`;
  return poll.active ? `до ${local(poll.endsAt)}` : `завершён ${local(poll.endsAt)}`;
}

export function PollCard({ poll, onVote, company }: { poll: Poll; onVote?: (optionId: string) => Promise<void>; company?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const total = poll.options.reduce((sum, option) => sum + (option.count ?? 0), 0);
  const leader = Math.max(0, ...poll.options.map((option) => option.count ?? 0));
  const vote = async (optionId: string) => {
    if (!onVote) return;
    setBusy(optionId);
    try { await onVote(optionId); } finally { setBusy(null); }
  };
  return (
    <section className="poll-card">
      <div className="poll-head">
        <span className={`tag ${poll.active ? 'tag-new' : 'tag-muted'}`}>{poll.active ? 'идёт' : 'завершён'}</span>
        <span className="poll-meta">{poll.scope}</span>
        <span className="poll-meta poll-until">{until(poll)}</span>
      </div>
      <h3 className="poll-question">{poll.question}</h3>
      <p className="poll-meta">{poll.anonymous ? 'Анонимный: соседи видят только числа' : 'Открытый: видно, какие квартиры за что'}{poll.allowChange ? ', голос можно изменить' : ', голос окончательный'}</p>
      <div className="poll-options">
        {poll.options.map((option) => {
          const share = poll.showResults && total ? Math.round(((option.count ?? 0) / total) * 100) : 0;
          const mine = poll.myOptionId === option.id;
          return (
            <div key={option.id} className={`poll-option${mine ? ' poll-option-mine' : ''}`}>
              <button type="button" className="poll-option-main" disabled={!poll.canVote || Boolean(busy) || mine} onClick={() => void vote(option.id)} aria-pressed={mine}>
                {poll.showResults ? <i className={`poll-bar${(option.count ?? 0) === leader && leader > 0 ? ' poll-bar-lead' : ''}`} style={{ width: `${share}%` }} /> : null}
                <span className="poll-option-text">{mine ? '✓ ' : ''}{option.text}</span>
                {poll.showResults ? <span className="poll-option-count">{option.count ?? 0} · {share}%</span> : busy === option.id ? <span className="poll-option-count">…</span> : null}
              </button>
              {option.apartments?.length ? (
                <button type="button" className="link-button poll-who" onClick={() => setOpen(open === option.id ? null : option.id)}>
                  {open === option.id ? 'Скрыть квартиры' : `Квартиры: ${option.apartments.length}`}
                </button>
              ) : null}
              {open === option.id && option.apartments ? <p className="poll-apartments">{option.apartments.join(', ')}</p> : null}
            </div>
          );
        })}
      </div>
      <p className="poll-meta">
        {poll.showResults ? `Проголосовало ${total} ${plural(total, 'квартира', 'квартиры', 'квартир')}` : 'Результаты откроются после вашего голоса'}
        {company ? null : poll.myOptionId && poll.active && poll.allowChange ? '. Чтобы изменить голос, выберите другой вариант' : ''}
      </p>
    </section>
  );
}

export function PollsScreen() {
  const data = useLoad(() => api.polls(), []);
  const unread = useUnread();
  const { showSnackbar } = useSnackbar();
  const [items, setItems] = useState<Poll[] | null>(null);
  const list = items ?? data.data ?? null;
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!list) return <Loading />;
  const vote = async (pollId: string, optionId: string) => {
    try {
      const item = await api.vote(pollId, optionId);
      setItems(list.map((poll) => (poll.id === pollId ? item : poll)));
      bridge.haptic('success');
      void unread.refresh();
    } catch (error) { showSnackbar({ text: errorText(error) }); }
  };
  return (
    <Page title="Опросы" subtitle="Управляющая компания спрашивает мнение жителей. Голос — один от квартиры">
      {list.length ? list.map((poll) => <PollCard key={poll.id} poll={poll} onVote={(optionId) => vote(poll.id, optionId)} />)
        : <Empty icon="chart" title="Опросов пока нет" text="Когда УК начнёт опрос, бот пришлёт сообщение, а вопрос появится здесь." />}
    </Page>
  );
}

// ---------- the company ----------

export function DeskPollsScreen() {
  const navigation = useNavigation();
  const confirm = useConfirm();
  const { showSnackbar } = useSnackbar();
  const data = useLoad(() => api.desk.polls(), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  return (
    <Page title="Опросы" subtitle="Вопрос жителям всех домов или одного дома, с таймером" after={<Button size="small" onClick={() => navigation.push({ name: 'desk-poll-new' })}>+ Опрос</Button>}>
      {data.data.length ? data.data.map((poll) => (
        <div key={poll.id} className="poll-desk">
          <PollCard poll={poll} company />
          <p className="poll-meta">Явка: {poll.votes} из {poll.apartmentsTotal} {plural(poll.apartmentsTotal, 'квартиры', 'квартир', 'квартир')}{poll.apartmentsTotal ? ` (${Math.round((poll.votes / poll.apartmentsTotal) * 100)}%)` : ''}</p>
          <div className="button-pair">
            {poll.active ? <Button size="medium" variant="secondary" stretched onClick={async () => {
              if (!await confirm({ text: 'Завершить опрос сейчас? Голосовать больше будет нельзя.', confirm: 'Завершить' })) return;
              try { await api.desk.closePoll(poll.id); await data.reload(); } catch (error) { showSnackbar({ text: errorText(error) }); }
            }}>Завершить</Button> : null}
            <Button size="medium" variant="secondary" stretched onClick={async () => {
              if (!await confirm({ text: 'Удалить опрос вместе с голосами?', confirm: 'Удалить', destructive: true })) return;
              try { await api.desk.deletePoll(poll.id); await data.reload(); } catch (error) { showSnackbar({ text: errorText(error) }); }
            }}>Удалить</Button>
          </div>
        </div>
      )) : <Empty icon="chart" title="Опросов пока нет" text="Спросите жителей: удобное время работ, выбор подрядчика, благоустройство двора." />}
    </Page>
  );
}

export function DeskPollNewScreen() {
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const houses = useLoad(() => api.desk.buildings(), []);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [scope, setScope] = useState('all');
  const overview = useLoad(() => api.desk.overview(), []);
  // How long the poll lasts: any of the four fields, the empty ones count as zero.
  const [length, setLength] = useState({ days: '3', hours: '', minutes: '', seconds: '' });
  const seconds = Number(length.days || 0) * 86_400 + Number(length.hours || 0) * 3_600 + Number(length.minutes || 0) * 60 + Number(length.seconds || 0);
  const lengthOk = seconds >= 10 && seconds <= 90 * 86_400;
  const zone = overview.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const endsAt = new Date(Date.now() + seconds * 1000);
  const setPart = (key: keyof typeof length) => (event: { target: { value: string } }) => setLength((current) => ({ ...current, [key]: event.target.value.replace(/\D/g, '').slice(0, 5) }));
  const [anonymous, setAnonymous] = useState(true);
  const [allowChange, setAllowChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const filled = options.map((option) => option.trim()).filter(Boolean);
  const ready = lengthOk && question.trim().length >= 3 && filled.length >= 2 && new Set(filled.map((option) => option.toLowerCase())).size === filled.length;
  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.desk.createPoll({ question: question.trim(), options: filled, buildingId: scope === 'all' ? null : scope, endsAt: new Date(Date.now() + seconds * 1000).toISOString(), anonymous, allowChange });
      showSnackbar({ text: `Опрос начат. Уведомление получат ${result.recipients} ${plural(result.recipients, 'житель', 'жителя', 'жителей')}` });
      navigation.back();
    } catch (error) { showSnackbar({ text: errorText(error) }); } finally { setBusy(false); }
  };
  return (
    <Page title="Новый опрос">
      <div className="form">
        <Field label="Вопрос"><Textarea maxLength={300} value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Когда удобнее провести покраску подъезда?" /></Field>
        <Field label={`Варианты ответа: ${filled.length} из 15`} hint="От 2 до 15, без повторов">
          <div className="poll-edit-options">
            {options.map((option, index) => (
              <div key={index} className="poll-edit-row">
                <Input maxLength={200} value={option} onChange={(event) => setOptions(options.map((value, at) => (at === index ? event.target.value : value)))} placeholder={`Вариант ${index + 1}`} />
                {options.length > 2 ? <button type="button" className="dial-remove" aria-label="Убрать вариант" onClick={() => setOptions(options.filter((_, at) => at !== index))}>×</button> : null}
              </div>
            ))}
            {options.length < 15 ? <button type="button" className="link-button" onClick={() => setOptions([...options, ''])}>Добавить вариант</button> : null}
          </div>
        </Field>
        <Field label="Кому">
          <select className="native-select" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="all">Всем домам УК</option>
            {(houses.data ?? []).map((house) => <option key={house.id} value={house.id}>{house.address}</option>)}
          </select>
        </Field>
        <Field label="Сколько длится" hint="Заполните только нужное: например, «30» в секундах — опрос на 30 секунд. Пустые поля считаются нулём. От 10 секунд до 90 дней">
          <div className="duration-row">
            <label><Input inputMode="numeric" value={length.days} onChange={setPart('days')} placeholder="0" /><span>дни</span></label>
            <label><Input inputMode="numeric" value={length.hours} onChange={setPart('hours')} placeholder="0" /><span>часы</span></label>
            <label><Input inputMode="numeric" value={length.minutes} onChange={setPart('minutes')} placeholder="0" /><span>минуты</span></label>
            <label><Input inputMode="numeric" value={length.seconds} onChange={setPart('seconds')} placeholder="0" /><span>секунды</span></label>
          </div>
        </Field>
        <p className={`field-hint duration-result${lengthOk ? '' : ' form-error'}`}>{lengthOk ? `${spellDuration(seconds)}: закончится ${zoned(endsAt, zone)} по местному времени УК (${zoneOffset(zone, endsAt)})` : seconds < 10 ? 'Укажите хотя бы 10 секунд' : 'Не дольше 90 дней'}</p>
        <label className="consent"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span><b>Анонимный опрос.</b> Жители видят только, сколько квартир выбрали каждый вариант. В пульте видно, какие квартиры за что голосовали.</span></label>
        <label className="consent"><input type="checkbox" checked={allowChange} onChange={(event) => setAllowChange(event.target.checked)} /><span><b>Можно изменить голос</b> до окончания опроса.</span></label>
      </div>
      <Actions><Button size="large" stretched loading={busy} disabled={!ready || busy} onClick={() => void submit()}>Начать опрос и уведомить жителей</Button></Actions>
    </Page>
  );
}
