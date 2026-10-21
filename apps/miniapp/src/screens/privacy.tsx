import { useLoad } from '../session';
import { Failure, Loading, Page } from '../components/ui';

type Privacy = { title: string; intro: string; sections: Array<{ title: string; text: string }> };

// The privacy policy inside the app: the same text the platform edits.
export function PrivacyScreen() {
  const data = useLoad(() => fetch('/api/privacy').then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить политику. Попробуйте ещё раз.');
    return response.json() as Promise<{ item: Privacy }>;
  }).then((body) => body.item), []);
  if (data.error) return <Failure text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const policy = data.data;
  const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <Page title="Персональные данные" subtitle={policy.title}>
      {policy.intro ? <div className="info-card"><span className="info-card-text multiline">{policy.intro}</span></div> : null}
      {policy.sections.map((section, index) => (
        <section key={`${section.title}-${index}`} className="section">
          <h2 className="section-header">{index + 1}. {section.title}</h2>
          <div className="info-card duties-card">
            {lines(section.text).length > 1
              ? <ul className="duties-list">{lines(section.text).map((line) => <li key={line}>{line}</li>)}</ul>
              : <span className="info-card-text">{section.text}</span>}
          </div>
        </section>
      ))}
    </Page>
  );
}
