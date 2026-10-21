import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from '@maxhub/max-ui';
import { Sheet } from './ui';

// A question inside the app ("Отменить заявку?") instead of the browser's
// window, which MAX shows on top of everything with the site address.

type Question = { text: string; confirm?: string; cancel?: string; destructive?: boolean; option?: string };
// "No" is false; "yes" is an object with the tick of the option, so
// `if (!await confirm(...))` reads naturally.
type Answer = false | { option: boolean };
type Ask = (question: Question) => Promise<Answer>;

const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [option, setOption] = useState(false);
  const answer = useRef<((value: Answer) => void) | null>(null);
  const ask = useCallback<Ask>((next) => new Promise<Answer>((resolve) => {
    answer.current?.(false);
    answer.current = resolve;
    setOption(false);
    setQuestion(next);
  }), []);
  const close = (yes: boolean) => {
    answer.current?.(yes ? { option } : false);
    answer.current = null;
    setQuestion(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Sheet open={Boolean(question)} onClose={() => close(false)}>
        {question ? (
          <div className="sheet confirm-sheet">
            <p className="confirm-text">{question.text}</p>
            {question.option ? (
              <label className="confirm-option">
                <input type="checkbox" checked={option} onChange={(event) => setOption(event.target.checked)} />
                <span>{question.option}</span>
              </label>
            ) : null}
            <Button size="large" stretched variant={question.destructive ? 'destructive' : 'primary'} onClick={() => close(true)}>{question.confirm ?? 'Да'}</Button>
            <Button size="large" stretched variant="secondary" onClick={() => close(false)}>{question.cancel ?? 'Отмена'}</Button>
          </div>
        ) : null}
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm outside ConfirmProvider');
  return ask;
}
