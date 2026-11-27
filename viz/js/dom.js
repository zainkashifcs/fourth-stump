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
  return { el, set };
}
