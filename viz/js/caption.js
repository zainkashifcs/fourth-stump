// Broadcast captions laid over a 3D view: a small camera tag, a lower-third strap
// naming the action and the outcome, and a flash for a dismissal. They are
// decoration for sighted visitors; the same words reach assistive technology
// through the page's live regions.
import { h } from './dom.js';

export function createCaption(viewport) {
  const action = h('span', { class: 'cap-action' });
  const outcome = h('span', { class: 'cap-outcome' });
  const strap = h('div', { class: 'cap-strap', hidden: true }, action, outcome);
  const flash = h('div', { class: 'cap-flash', hidden: true });
  const tag = h('span', { class: 'cap-tag', hidden: true });
  viewport.append(tag, strap, flash);

  return {
    show({ action: actionText, outcome: outcomeText, flash: flashText }) {
      action.textContent = actionText;
      outcome.textContent = outcomeText;
      outcome.hidden = !outcomeText;
      strap.hidden = false;
      flash.textContent = flashText ?? '';
      flash.hidden = !flashText;
    },
    clear() {
      strap.hidden = true;
      flash.hidden = true;
    },
    // the live camera, while the director is cutting between them; null hides it
    setTag(text) {
      tag.textContent = text ?? '';
      tag.hidden = !text;
    },
  };
}
