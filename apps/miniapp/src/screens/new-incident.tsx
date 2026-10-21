import { useEffect, useState } from 'react';
import { Button, CellSimple, Steps, Textarea, Typography, useSnackbar } from '@maxhub/max-ui';
import { api, errorText, type Category, type DraftInput, type Similar, type Zone } from '../api';
import { bridge } from '../bridge';
import { useNavigation, useStepBack } from '../nav';
import { useSession } from '../session';
import { Actions, Empty, Page, Plate, Section, StatusChip } from '../components/ui';
import { CategoryTile, IconTile } from '../components/icons';
import { ago, categoryLabels, plural, zoneLabels } from '../labels';

// Reporting a problem: where it is, what it is, a few words — and before the
// incident is created the resident sees whether neighbours already reported
// the same thing. Joining instead of duplicating is the heart of the service.

type Scope = 'building' | 'apartment';
type CommonZone = Exclude<Zone, 'apartment'>;

const buildingCategories: Category[] = ['water', 'electricity', 'heating', 'elevator', 'leak', 'cleaning', 'other'];
const apartmentCategories: Category[] = ['water', 'electricity', 'heating', 'leak', 'other'];
// Where a problem of each kind can be (the same rules as on the server).
const zonesByCategory: Record<Category, CommonZone[]> = {
  water: ['common'],
  electricity: ['entrance', 'yard', 'common'],
  heating: ['entrance', 'common'],
  elevator: ['elevator'],
  leak: ['entrance', 'common'],
  cleaning: ['entrance', 'elevator', 'yard', 'common'],
  other: ['entrance', 'elevator', 'yard', 'common'],
};

type Urgency = 'normal' | 'high' | 'emergency';
const urgencies: Array<{ id: Urgency; title: string; text: string }> = [
  { id: 'normal', title: 'Обычная', text: 'Неудобно, но можно подождать: перегорела лампа, грязно в подъезде' },
  { id: 'high', title: 'Срочная', text: 'Нужно решить сегодня: нет горячей воды, не работает лифт' },
  { id: 'emergency', title: 'Авария', text: 'Нужно немедленно: затопление, искрит проводка, запах газа, человек застрял в лифте' },
];

type Step = 'scope' | 'category' | 'place' | 'describe' | 'similar' | 'done';

export function NewIncidentScreen() {
  const { me } = useSession();
  const navigation = useNavigation();
  const { showSnackbar } = useSnackbar();
  const [step, setStep] = useState<Step>('scope');
  const [scope, setScope] = useState<Scope>('building');
  const [category, setCategory] = useState<Category | null>(null);
  const [zone, setZone] = useState<CommonZone | null>(null);
  const [entrance, setEntrance] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Urgency>('normal');
  const [photos, setPhotos] = useState<string[]>([]);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; number: number; joined: boolean } | null>(null);

  // "Back" goes one step back in the form, not out of it.
  const previousStep: Partial<Record<Step, Step>> = {
    category: 'scope',
    place: 'category',
    describe: scope === 'apartment' || (category && zonesByCategory[category].length === 1 && !(zonesByCategory[category][0] === 'elevator' && (me.residence?.building.entrancesCount ?? 1) > 1)) ? 'category' : 'place',
    similar: 'describe',
  };
  useStepBack(Boolean(previousStep[step]), () => { const target = previousStep[step]; if (target) setStep(target); });

  // A half-filled report should not be lost by an accidental swipe.
  useEffect(() => {
    bridge.confirmClosing(step !== 'scope' && step !== 'done');
    return () => bridge.confirmClosing(false);
  }, [step]);

  if (!me.residence) {
    return (
      <Page title="Новая заявка">
        <Empty icon="building" title="Сначала подтвердите квартиру" text="Найдите свой дом на карте — так заявка попадёт в нужную УК." action={<Button size="medium" onClick={() => navigation.switchTab('map')}>Открыть карту</Button>} />
      </Page>
    );
  }
  const entrances = me.residence.building.entrancesCount;
  const placeChoices = category ? zonesByCategory[category] : [];
  const effectiveZone: CommonZone | null = placeChoices.length === 1 ? placeChoices[0]! : zone;
  const needsEntrance = scope === 'building' && (effectiveZone === 'entrance' || effectiveZone === 'elevator');
  const draft = (): DraftInput => ({
    scope, category: category!,
    ...(scope === 'building' && effectiveZone ? { locationZone: effectiveZone } : {}),
    ...(needsEntrance && entrance ? { entranceNumber: entrance } : {}),
  });

  const order: Step[] = ['scope', 'category', 'place', 'describe'];
  const progress = Math.max(0, order.indexOf(step));

  // Every choice clears the choices that depend on it, so going back and
  // picking something else never carries an old zone or entrance along.
  const chooseScope = (picked: Scope) => {
    setScope(picked); setCategory(null); setZone(null); setEntrance(null); setStep('category');
  };

  const toDescribeOrPlace = (picked: Category) => {
    setCategory(picked);
    setZone(null);
    setEntrance(null);
    const choices = zonesByCategory[picked];
    if (scope === 'apartment') setStep('describe');
    else if (choices.length === 1) {
      // One possible place: not asked. A lift still needs its entrance.
      const only = choices[0]!;
      setZone(only);
      if ((only === 'elevator' || only === 'entrance') && entrances > 1) setStep('place');
      else { if (only === 'elevator' || only === 'entrance') setEntrance(1); setStep('describe'); }
    }
    else setStep('place');
  };

  const checkSimilar = async () => {
    setBusy(true);
    try {
      const matches = scope === 'building' ? await api.similar(draft()) : [];
      if (matches.length) { setSimilar(matches); setStep('similar'); }
      else await create();
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const item = await api.createIncident({ ...draft(), description: description.trim(), priority, ...(photos.length ? { photos } : {}) });
      bridge.haptic('success');
      setCreated({ ...item, joined: false });
      setStep('done');
    } catch (error) {
      bridge.haptic('error');
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const join = async (match: Similar) => {
    setBusy(true);
    try {
      await api.joinIncident(match.id);
      bridge.haptic('success');
      setCreated({ id: match.id, number: match.number, joined: true });
      setStep('done');
    } catch (error) {
      showSnackbar({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done' && created) {
    return (
      <Page title={created.joined ? 'Вы присоединились' : 'Заявка создана'}>
        <div className="hero-card done-card">
          <Plate size="large">№ {created.number}</Plate>
          <Typography.Body variant="medium">
            {created.joined
              ? 'УК видит, что проблема касается ещё одной квартиры. Чем больше соседей присоединится, тем выше приоритет заявки.'
              : 'Заявка ушла в управляющую компанию. О каждом изменении статуса бот напишет вам в MAX.'}
          </Typography.Body>
          <Button size="large" stretched onClick={() => navigation.replace({ name: 'incident', ref: created.id })}>Открыть заявку</Button>
          <Button size="large" variant="secondary" stretched onClick={() => navigation.switchTab('home')}>На главную</Button>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Новая заявка" subtitle={`${me.residence.building.address}, кв. ${me.residence.apartmentNumber}`}>
      {step !== 'similar' ? <Steps count={4} progress={progress + 1} /> : null}

      {step === 'scope' ? (
        <Section header="Где проблема?">
          <CellSimple as="button" before={<IconTile name="building" color="#007aff" size={40} />} title="В доме" subtitle="Подъезд, лифт, двор, подвал — касается соседей" onClick={() => chooseScope('building')} showChevron />
          <CellSimple as="button" before={<IconTile name="door" color="#ff9500" size={40} />} title="В моей квартире" subtitle="Видят только жители квартиры и УК" onClick={() => chooseScope('apartment')} showChevron />
        </Section>
      ) : null}

      {step === 'category' ? (
        <>
          <Typography.Title variant="medium-strong">Что случилось?</Typography.Title>
          <div className="choice-grid">
            {(scope === 'building' ? buildingCategories : apartmentCategories).map((item) => (
              <button key={item} type="button" className={`choice${category === item ? ' choice-active' : ''}`} onClick={() => toDescribeOrPlace(item)}>
                <CategoryTile category={item} size={44} />
                <span>{categoryLabels[item]}</span>
              </button>
            ))}
          </div>
          <Actions><Button variant="ghost" size="medium" onClick={() => setStep('scope')}>Назад</Button></Actions>
        </>
      ) : null}

      {step === 'place' ? (
        <>
          {placeChoices.length > 1 ? (
            <>
              <Typography.Title variant="medium-strong">Где именно?</Typography.Title>
              <div className="choice-grid">
                {placeChoices.map((item) => (
                  <button key={item} type="button" className={`choice${zone === item ? ' choice-active' : ''}`} onClick={() => { setZone(item); setEntrance(null); if (item === 'yard' || item === 'common') setStep('describe'); }}>
                    <span>{zoneLabels[item]}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {needsEntrance ? (
            <>
              <Typography.Title variant="medium-strong">Какой подъезд?</Typography.Title>
              <div className="choice-row">
                {Array.from({ length: entrances }, (_, index) => index + 1).map((number) => (
                  <button key={number} type="button" className={`choice choice-small${entrance === number ? ' choice-active' : ''}`} onClick={() => { setEntrance(number); setStep('describe'); }}>{number}</button>
                ))}
              </div>
            </>
          ) : null}
          <Actions><Button variant="ghost" size="medium" onClick={() => setStep('category')}>Назад</Button></Actions>
        </>
      ) : null}

      {step === 'describe' ? (
        <div className="form">
          <Typography.Title variant="medium-strong">Опишите коротко</Typography.Title>
          <Typography.Body variant="small" className="muted">
            {categoryLabels[category!]}{scope === 'building' && effectiveZone ? `, ${zoneLabels[effectiveZone]}${entrance ? `, подъезд ${entrance}` : ''}` : ', в квартире'}
          </Typography.Body>
          <div className="tip-card">
            <span className="tip-card-title">Что важно указать</span>
            <ul>
              <li>Где именно: этаж, квартира рядом, место во дворе</li>
              <li>С какого времени это происходит</li>
              <li>Что видно или слышно: течёт, искрит, пахнет газом</li>
              <li>Есть ли опасность для людей</li>
            </ul>
          </div>
          <Textarea placeholder="Например: с 8 утра на 5 этаже течёт с потолка у лифта, вода на полу" value={description} maxLength={500} rows={5} onChange={(event) => setDescription(event.target.value)} />
          <Typography.Body variant="small" className="muted">{description.trim().length} из 500</Typography.Body>
          <PhotoPicker photos={photos} onChange={setPhotos} />
          <span className="form-label">Насколько срочно</span>
          <div className="urgency-list" role="radiogroup" aria-label="Срочность">
            {urgencies.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={priority === item.id} className={`urgency urgency-${item.id}${priority === item.id ? ' urgency-active' : ''}`} onClick={() => setPriority(item.id)}>
                <span className="urgency-dot" />
                <span className="urgency-text"><span className="urgency-title">{item.title}</span><span className="urgency-sub">{item.text}</span></span>
              </button>
            ))}
          </div>
          {priority === 'emergency' ? (
            <div className="alert-card">Если есть угроза жизни или здоровью, сначала позвоните <a href="tel:112">112</a>. Аварийные службы — во вкладке «Службы».</div>
          ) : null}
          <Button size="large" stretched disabled={description.trim().length < 5 || busy} loading={busy} onClick={() => void checkSimilar()}>Отправить</Button>
          <Button variant="ghost" size="medium" onClick={() => setStep(scope === 'apartment' ? 'category' : 'place')}>Назад</Button>
        </div>
      ) : null}

      {step === 'similar' ? (
        <>
          <div className="hero-card">
            <Typography.Title variant="medium-strong">Соседи уже сообщили</Typography.Title>
            <Typography.Body variant="small" className="muted">
              Похоже, это та же проблема. Присоединитесь — УК увидит, что она касается ещё одной квартиры, а вы получите те же уведомления.
            </Typography.Body>
          </div>
          <Section>
            {similar.map((match) => (
              <CellSimple
                key={match.id}
                overline={<span className="cell-overline"><Plate size="small">№ {match.number}</Plate><StatusChip status={match.status} /></span>}
                title={match.title}
                subtitle={`${match.reportsCount} ${plural(match.reportsCount, 'житель', 'жителя', 'жителей')}, ${ago(match.createdAt)}`}
                after={<Button size="small" disabled={busy} onClick={() => void join(match)}>Я тоже</Button>}
              />
            ))}
          </Section>
          <Actions>
            <Button variant="secondary" size="large" stretched disabled={busy} onClick={() => void create()}>Нет, у меня другое — создать заявку</Button>
          </Actions>
        </>
      ) : null}
    </Page>
  );
}

// A photo of the problem: from the camera or the gallery, made smaller on the
// phone (1280 px on the long side, JPEG) so that it goes quickly.
async function shrink(file: File): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('not an image'));
    image.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1280 / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.naturalWidth * scale);
  canvas.height = Math.round(source.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(source.src);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (photos: string[]) => void }) {
  const { showSnackbar } = useSnackbar();
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const added = await Promise.all([...files].slice(0, 3 - photos.length).map(shrink));
      onChange([...photos, ...added].slice(0, 3));
    } catch {
      showSnackbar({ text: 'Не получилось прочитать фото. Попробуйте другое.' });
    }
  };
  return (
    <div className="photo-picker">
      <span className="form-label">Фото, до трёх — по желанию</span>
      <div className="photo-picker-row">
        {photos.map((photo, index) => (
          <div key={index} className="photo-thumb">
            <img src={photo} alt={`Фото ${index + 1}`} />
            <button type="button" aria-label="Убрать фото" onClick={() => onChange(photos.filter((_, other) => other !== index))}>×</button>
          </div>
        ))}
        {photos.length < 3 ? (
          <label className="photo-add">
            <input type="file" accept="image/*" multiple hidden onChange={(event) => { void add(event.target.files); event.target.value = ''; }} />
            <span className="photo-add-plus">+</span>
            <span>Добавить</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
