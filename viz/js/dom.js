// Small DOM helpers shared by the two views.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === false || value == null) return;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  });
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return el;
}

let groupCount = 0;

// A segmented control built from native radio buttons, so arrow keys, focus
// and form semantics come from the platform.
export function segmented({ legend, hideLegend = false, options, value, onChange, className = '' }) {
  groupCount += 1;
  const name = `seg-${groupCount}`;
  const inputs = options.map((option, index) => {
    const id = `${name}-${index}`;
    const input = h('input', { type: 'radio', name, id, value: String(option.value) });
    input.checked = option.value === value;
    input.addEventListener('change', () => onChange(option.value));
    return { option, input, label: h('label', { for: id, text: option.label }) };
  });
  const el = h(
    'fieldset',
    { class: `segmented ${className}` },
    h('legend', { class: hideLegend ? 'visually-hidden' : '', text: legend }),
    h('div', { class: 'segmented-options' }, inputs.map(({ input, label }) => [input, label])),
  );
  const set = (next) => inputs.forEach(({ option, input }) => { input.checked = option.value === next; });
  const disable = (off) => inputs.forEach(({ input }) => { input.disabled = off; });
  return { el, set, disable };
}

// A native checkbox with its label, styled as a switch.
export function toggle({ label, checked, onChange }) {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', { text: label }));
}

// A yes/no choice kept in localStorage; it still works, unremembered, when storage is blocked.
export function remembered(key, fallback) {
  let value = fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored != null) value = stored === 'yes';
  } catch { /* storage blocked */ }
  return {
    get: () => value,
    set(next) {
      value = next;
      try {
        localStorage.setItem(key, next ? 'yes' : 'no');
      } catch { /* storage blocked */ }
    },
  };
}
