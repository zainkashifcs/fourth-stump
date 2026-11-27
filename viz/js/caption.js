// Broadcast captions laid over a 3D view: a small camera tag, a lower-third strap
// naming the action and the outcome, the commentator's ticker above it, and a
// flash for a dismissal. They are decoration for sighted visitors; the same
// words reach assistive technology through the page's live regions.
import { h } from './dom.js';
import { deliveryStarts, kindOf, lineFor, outcomeShown } from './commentary.js';

export function createCaption(viewport) {
  const action = h('span', { class: 'cap-action' });
  const outcome = h('span', { class: 'cap-outcome' });
  const strap = h('div', { class: 'cap-strap', hidden: true }, action, outcome);
  const call = h('span', { class: 'cap-call' });
  const clause = h('span', { class: 'cap-clause', hidden: true });
  const comment = h('p', { class: 'cap-comment', hidden: true }, call, clause);
  const flash = h('div', { class: 'cap-flash', hidden: true });
  const tag = h('span', { class: 'cap-tag', hidden: true });
  // the ticker stacks above the strap, so a strap that wraps never runs into it
  viewport.append(tag, h('div', { class: 'cap-lower' }, comment, strap), flash);
  let shows = 0; // a reveal from an earlier delivery must not touch this one

  const self = {
    // quiet: the delivery was already shown and spoken, and is only being drawn again.
    // length: the delivery's length, 'good' | 'yorker' | 'bouncer', for the commentator's line.
    show({ action: actionText, outcome: outcomeText, flash: flashText }, { quiet = false, length = 'good' } = {}) {
      shows += 1;
      const mine = shows;
      action.textContent = actionText;
      outcome.textContent = outcomeText;
      outcome.hidden = !outcomeText;
      strap.hidden = false;
      flash.textContent = flashText ?? '';
      flash.hidden = !flashText;
      const kind = kindOf({ outcome: outcomeText });
      const line = lineFor(kind, length);
      const [first, second] = line?.beats ?? [];
      call.textContent = first ?? '';
      clause.textContent = second ? ` ${second}` : '';
      clause.hidden = true;
      comment.hidden = !line;
      const reveal = () => {
        if (mine === shows && second) clause.hidden = false;
      };
      if (quiet) reveal();
      else outcomeShown(self, kind, length, reveal);
    },
    clear() {
      shows += 1;
      strap.hidden = true;
      flash.hidden = true;
      comment.hidden = true;
      deliveryStarts(self);
    },
    // the live camera, while the director is cutting between them; null hides it
    setTag(text) {
      tag.textContent = text ?? '';
      tag.hidden = !text;
    },
  };
  return self;
}
