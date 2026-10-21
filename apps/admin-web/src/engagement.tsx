import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, plural } from './api';

// Polls of the company and the reception of citizens in the web desk: the
// same as in the desk of the mini-app, on a big screen.

type Notify = (text: string, tone?: 'success' | 'error') => void;
const app = (path: string) => `/api/app${path}`;
// Times of polls and the reception are those of the city of the company.
const zoned = (value: string | Date, zone: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) => new Date(value).toLocaleString('ru-RU', { ...options, timeZone: zone });
const zoneOffset = (zone: string, at: Date = new Date()) => (new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
function zonedToUtc(date: string, time: string, zone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year!, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const offsetAt = (moment: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(moment)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - moment;
  };
  return new Date(wall - offsetAt(wall - offsetAt(wall)));
}
function spellDuration(seconds: number) {
  const parts = [[Math.floor(seconds / 86_400), 'дн.'], [Math.floor((seconds % 86_400) / 3_600), 'ч'], [Math.floor((seconds % 3_600) / 60), 'мин'], [seconds % 60, 'с']] as const;
  return parts.filter(([value]) => value).map(([value, unit]) => `${value} ${unit}`).join(' ') || '0 с';
}
const useCompanyZone = () => {
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  useEffect(() => { void api<{ timeZone: string }>(app('/company/overview')).then((data) => setZone(data.timeZone)).catch(() => undefined); }, []);
  return zone;
};

type PollOption = { id: string; text: string; count?: number; apartments?: string[] };
type Poll = { id: string; question: string; scope: string; timeZone: string; zoneLabel: string; anonymous: boolean; allowChange: boolean; endsAt: string; closedAt: string | null; createdAt: string; active: boolean; votes: number; apartmentsTotal: number; options: PollOption[] };
type House = { id: string; address: string };

const errors: Record<string, string> = {
  invalid_poll: 'Проверьте вопрос и варианты: от 2 до 15, без повторов.',
  poll_ends_at: 'Опрос должен длиться от 10 минут до 90 дней.',
};

export function PollsManager({ onNotice }: { onNotice: Notify }) {
  const [items, setItems] = useState<Poll[] | null>(null);
  const [houses, setHouses] = useState<House[]>([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [scope, setScope] = useState('all');
  const zone = useCompanyZone();
  // How long the poll lasts: any of the four fields, the empty ones count as zero.
  const [length, setLength] = useState({ days: '3', hours: '', minutes: '', seconds: '' });
  const seconds = Number(length.days || 0) * 86_400 + Number(length.hours || 0) * 3_600 + Number(length.minutes || 0) * 60 + Number(length.seconds || 0);
  const lengthOk = seconds >= 10 && seconds <= 90 * 86_400;
  const endsAt = new Date(Date.now() + seconds * 1000);
  const [anonymous, setAnonymous] = useState(true);
  const [allowChange, setAllowChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const reload = async () => { try { setItems((await api<{ items: Poll[] }>(app('/company/polls'))).items); } catch { onNotice('Не удалось загрузить опросы.', 'error'); } };
  useEffect(() => {
    void reload();
    void api<{ items: House[] }>('/api/buildings').then(({ items: value }) => setHouses(value)).catch(() => setHouses([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filled = options.map((option) => option.trim()).filter(Boolean);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ recipients: number }>(app('/company/polls'), { method: 'POST', body: JSON.stringify({ question: question.trim(), options: filled, buildingId: scope === 'all' ? null : scope, endsAt: new Date(Date.now() + seconds * 1000).toISOString(), anonymous, allowChange }) });
      onNotice(`Опрос начат. Уведомление получат ${result.recipients} ${plural(result.recipients, 'житель', 'жителя', 'жителей')}.`);
      setQuestion(''); setOptions(['', '']);
      await reload();
    } catch (failure) { onNotice(failure instanceof ApiError && failure.code ? errors[failure.code] ?? 'Не удалось начать опрос.' : 'Не удалось начать опрос.', 'error'); } finally { setBusy(false); }
  }
  const act = async (poll: Poll, action: 'close' | 'delete') => {
    if (!window.confirm(action === 'close' ? 'Завершить опрос сейчас? Голосовать больше будет нельзя.' : 'Удалить опрос вместе с голосами?')) return;
    try { await api(app(`/company/polls/${poll.id}${action === 'close' ? '/close' : ''}`), { method: action === 'close' ? 'POST' : 'DELETE' }); await reload(); } catch { onNotice('Не удалось выполнить действие.', 'error'); }
  };
  return <div className="buildings-layout">
    <section className="panel buildings-panel">
      <div className="panel-head"><div><h2>Опросы</h2><p className="form-hint">Голос — один от квартиры. В анонимном опросе жители видят только числа; здесь всегда видно, какие квартиры за что голосовали.</p></div></div>
      <div className="building-list">
        {items === null ? <p className="state-message">Загружаем…</p> : items.length === 0 ? <p className="state-message">Опросов пока нет. Начните первый в форме справа.</p> : items.map((poll) => {
          const total = poll.options.reduce((sum, option) => sum + (option.count ?? 0), 0);
          return <article className="building-row poll-row" key={poll.id}>
            <div className="poll-body">
              <h3>{poll.question}</h3>
              <p className="form-hint">{poll.scope} · {poll.active ? `идёт до ${zoned(poll.endsAt, poll.timeZone)}` : `завершён ${zoned(poll.closedAt ?? poll.endsAt, poll.timeZone)}`} по местному времени ({poll.zoneLabel}) · {poll.anonymous ? 'анонимный' : 'открытый'} · {poll.allowChange ? 'голос можно изменить' : 'голос окончательный'}</p>
              <div className="poll-results">{poll.options.map((option) => {
                const share = total ? Math.round(((option.count ?? 0) / total) * 100) : 0;
                return <div className="poll-result" key={option.id}>
                  <div className="poll-result-line"><span>{option.text}</span><strong>{option.count ?? 0} · {share}%</strong></div>
                  <div className="poll-track"><i style={{ width: `${share}%` }} /></div>
                  {open === poll.id && option.apartments?.length ? <p className="form-hint">{option.apartments.join(', ')}</p> : null}
                </div>;
              })}</div>
              <p className="form-hint">Явка: {poll.votes} из {poll.apartmentsTotal} {plural(poll.apartmentsTotal, 'квартиры', 'квартир', 'квартир')}{poll.apartmentsTotal ? ` (${Math.round((poll.votes / poll.apartmentsTotal) * 100)}%)` : ''}</p>
            </div>
            <div className="building-actions">
              {poll.votes ? <button className="filter" type="button" onClick={() => setOpen(open === poll.id ? null : poll.id)}>{open === poll.id ? 'Скрыть квартиры' : 'Показать квартиры'}</button> : null}
              {poll.active ? <button className="filter" type="button" onClick={() => void act(poll, 'close')}>Завершить</button> : null}
              <button className="filter danger" type="button" onClick={() => void act(poll, 'delete')}>Удалить</button>
            </div>
          </article>;
        })}
      </div>
    </section>
    <form className="status-form building-form" onSubmit={create}>
      <h3>Новый опрос</h3>
      <label>Вопрос<textarea required minLength={3} maxLength={300} rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Когда удобнее провести покраску подъезда?" /></label>
      <div className="poll-form-options"><span className="field-label-text">Варианты ответа: {filled.length} из 15</span>
        {options.map((option, index) => <div className="dial-row" key={index}>
          <input value={option} maxLength={200} onChange={(event) => setOptions(options.map((value, at) => (at === index ? event.target.value : value)))} placeholder={`Вариант ${index + 1}`} />
          {options.length > 2 ? <button className="filter danger small" type="button" onClick={() => setOptions(options.filter((_, at) => at !== index))}>Убрать</button> : <span />}
        </div>)}
        {options.length < 15 ? <button className="filter" type="button" onClick={() => setOptions([...options, ''])}>Добавить вариант</button> : null}
      </div>
      <label>Кому<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">Всем домам УК</option>{houses.map((house) => <option key={house.id} value={house.id}>{house.address}</option>)}</select></label>
      <div className="duration-field"><span className="field-label-text">Сколько длится</span>
        <div className="duration-grid">
          {([['days', 'дни'], ['hours', 'часы'], ['minutes', 'минуты'], ['seconds', 'секунды']] as const).map(([key, label]) => <label key={key}><input inputMode="numeric" value={length[key]} placeholder="0" onChange={(event) => setLength((current) => ({ ...current, [key]: event.target.value.replace(/\D/g, '').slice(0, 5) }))} /><span>{label}</span></label>)}
        </div>
        <span className="field-hint">Заполните только нужное: например, «30» в секундах — опрос на 30 секунд. Пустые поля — ноль. От 10 секунд до 90 дней.</span>
        <span className={lengthOk ? 'field-hint' : 'form-error'}>{lengthOk ? `${spellDuration(seconds)}: закончится ${zoned(endsAt, zone)} по местному времени УК (${zoneOffset(zone, endsAt)})` : seconds < 10 ? 'Укажите хотя бы 10 секунд.' : 'Не дольше 90 дней.'}</span>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Анонимный опрос: жители не видят, какие квартиры за что голосовали</label>
      <label className="checkbox-label"><input type="checkbox" checked={allowChange} onChange={(event) => setAllowChange(event.target.checked)} /> Можно изменить голос до окончания</label>
      <button className="primary" disabled={busy || !lengthOk || question.trim().length < 3 || filled.length < 2}>{busy ? 'Начинаем…' : 'Начать опрос и уведомить жителей'}</button>
    </form>
  </div>;
}

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------- reception ----------

type Slot = { id: string; startsAt: string; durationMinutes: number; topic: string | null; booked: boolean; resident: { name: string | null; phone: string | null; address: string | null } | null };

export function AppointmentsManager({ onNotice }: { onNotice: Notify }) {
  const [items, setItems] = useState<Slot[] | null>(null);
  const zone = useCompanyZone();
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3_600_000)).slice(0, 10));
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('13:00');
  const [step, setStep] = useState('20');
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { setItems((await api<{ items: Slot[] }>(app('/company/appointments'))).items); } catch { onNotice('Не удалось загрузить приём.', 'error'); } };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const starts: string[] = [];
  const begin = zonedToUtc(date, from, zone).getTime();
  const end = zonedToUtc(date, to, zone).getTime();
  for (let at = begin; Number(step) >= 5 && at + Number(step) * 60_000 <= end && starts.length < 100; at += Number(step) * 60_000) starts.push(new Date(at).toISOString());
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ created: number; skipped: number }>(app('/company/appointments'), { method: 'POST', body: JSON.stringify({ starts, durationMinutes: Number(step) }) });
      onNotice(`Открыто окон: ${result.created}${result.skipped ? `, уже были: ${result.skipped}` : ''}.`);
      await reload();
    } catch { onNotice('Не удалось открыть окна: проверьте день и время — они должны быть в будущем.', 'error'); } finally { setBusy(false); }
  }
  const remove = async (slot: Slot) => {
    if (!window.confirm(slot.booked ? 'Отменить приём? Житель получит сообщение об отмене.' : 'Убрать свободное окно?')) return;
    try { await api(app(`/company/appointments/${slot.id}`), { method: 'DELETE' }); await reload(); } catch { onNotice('Не удалось убрать окно.', 'error'); }
  };
  const days = new Map<string, Slot[]>();
  for (const slot of items ?? []) {
    const key = zoned(slot.startsAt, zone, { weekday: 'long', day: 'numeric', month: 'long' });
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  return <div className="buildings-layout">
    <section className="panel buildings-panel">
      <div className="panel-head"><div><h2>Окна приёма</h2><p className="form-hint">{items ? `Впереди: ${items.length}, занято: ${items.filter((slot) => slot.booked).length}. Время местное (${zoneOffset(zone)}).` : ''} Жители записываются в приложении: «Моя УК» → «Записаться на приём». О каждой записи приходит сообщение в MAX.</p></div><button className="filter" type="button" onClick={() => void reload()}>Обновить</button></div>
      <div className="building-list">
        {items === null ? <p className="state-message">Загружаем…</p> : items.length === 0 ? <p className="state-message">Окон пока нет. Откройте их в форме справа.</p> : [...days.entries()].map(([title, slots]) => <div className="street-group" key={title}>
          <h3 className="street-title">{title}<span>{slots.filter((slot) => slot.booked).length} из {slots.length} занято</span></h3>
          {slots.map((slot) => <article className="building-row" key={slot.id}>
            <div className="slot-body"><h3>{zoned(slot.startsAt, zone, { hour: '2-digit', minute: '2-digit' })} · {slot.booked ? 'записан житель' : 'свободно'}</h3>
              {slot.resident ? <p className="form-hint">{[slot.resident.address, [slot.resident.name, slot.resident.phone].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p> : null}
              {slot.topic ? <button type="button" className={`slot-topic${open === slot.id ? ' open' : ''}`} onClick={() => setOpen(open === slot.id ? null : slot.id)} title="Нажмите, чтобы показать тему целиком">Тема: {slot.topic}</button> : null}</div>
            <div className="building-actions"><button className="filter danger" type="button" onClick={() => void remove(slot)}>{slot.booked ? 'Отменить приём' : 'Убрать'}</button></div>
          </article>)}
        </div>)}
      </div>
    </section>
    <form className="status-form building-form" onSubmit={create}>
      <h3>Открыть окна</h3>
      <p className="form-hint">Время — по местному времени УК ({zoneOffset(zone)}).</p>
      <label>День<input type="date" required value={date} min={toLocalInput(new Date()).slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></label>
      <div className="form-pair"><label>С<input type="time" required value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>До<input type="time" required value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
      <label>Длительность одного приёма, минут<input inputMode="numeric" required value={step} onChange={(event) => setStep(event.target.value.replace(/\D/g, '').slice(0, 3))} /><span className="field-hint">От 5 минут. Окна идут подряд: 10:00, 10:20, 10:40…</span></label>
      <button className="primary" disabled={busy || !starts.length}>{starts.length ? `Открыть ${starts.length} ${plural(starts.length, 'окно', 'окна', 'окон')}` : 'Проверьте время и длительность'}</button>
    </form>
  </div>;
}
