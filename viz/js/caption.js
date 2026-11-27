// Broadcast captions laid over a 3D view: a small camera tag, a lower-third strap
// naming the action and the outcome, the commentator's line above it, and a
// flash for a dismissal. They are decoration for sighted visitors; the same
// words reach assistive technology through the page's live regions.
import { h } from './dom.js';
import { LINES, deliveryStarts, kindOf, outcomeShown } from './commentary.js';

export function createCaption(viewport) {
  const action = h('span', { class: 'cap-action' });
  const outcome = h('span', { class: 'cap-outcome' });
  const strap = h('div', { class: 'cap-strap', hidden: true }, action, outcome);
  const comment = h('p', { class: 'cap-comment', hidden: true });
  const flash = h('div', { class: 'cap-flash', hidden: true });
  const tag = h('span', { class: 'cap-tag', hidden: true });
  // the line stacks above the strap, so a strap that wraps never runs into it
  viewport.append(tag, h('div', { class: 'cap-lower' }, comment, strap), flash);
  const self = {
    // quiet: the delivery was already shown and spoken, and is only being drawn again
    show({ action: actionText, outcome: outcomeText, flash: flashText }, { quiet = false } = {}) {
      action.textContent = actionText;
      outcome.textContent = outcomeText;
      outcome.hidden = !outcomeText;
      strap.hidden = false;
      flash.textContent = flashText ?? '';
      flash.hidden = !flashText;
      const kind = kindOf({ outcome: outcomeText });
      comment.textContent = LINES[kind] ?? '';
      comment.hidden = !LINES[kind];
      if (!quiet) outcomeShown(self, kind);
    },
    clear() {
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
