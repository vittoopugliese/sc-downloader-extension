// A dropdown like Player Tools' preset menu: each row selects on click and has its own
// delete button, which never selects or loads the row. The list is a popover, so Escape
// and clicks outside close it; arrows, Home and End move between rows and Delete removes
// the focused one. `footer` adds an action row at the end (for example "+ New pattern").
const STYLES = `
.row-menu{position:relative;display:inline-flex;min-width:0}
.row-menu-toggle{display:inline-flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;max-width:100%;cursor:pointer;text-align:left}
.row-menu-toggle .row-menu-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-menu-toggle sc-icon{flex:0 0 auto;width:10px;height:10px}
.row-menu-toggle[aria-expanded=true]{border-color:#ff7b38}
.row-menu-list{position:fixed;inset:auto;margin:0;width:max-content;min-width:180px;max-width:min(320px,calc(100vw - 16px));max-height:min(320px,calc(100vh - 16px));overflow:auto;padding:5px;border:1px solid #494949;border-radius:8px;background:#242424;color:#fff;box-shadow:0 8px 24px #0008;font:11px/1.4 system-ui,sans-serif}
.row-menu-list p{margin:6px 8px;color:#aaa}
.row-menu-row{display:flex;gap:3px;min-height:24px}
.row-menu-list button{min-height:24px;padding:3px 6px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.row-menu-list button:hover:enabled{background:#383838}
.row-menu-list button:focus-visible{outline:2px solid #ff7b38;outline-offset:-2px}
.row-menu-list .row-menu-load{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-menu-list .row-menu-load[aria-checked=true]{color:#ff934d;font-weight:700}
.row-menu-list .row-menu-delete{flex:0 0 28px;text-align:center;font-size:17px;line-height:1;color:#aaa}
.row-menu-list .row-menu-delete:hover:enabled{color:#ff856b}
.row-menu-list .row-menu-delete.is-armed{flex:0 0 auto;padding:3px 8px;background:#4a2020;color:#ff8f8f;font-size:11px;font-weight:700}
.row-menu-list .row-menu-footer{width:100%;margin-top:4px;padding-top:6px;border-top:1px solid #414141;border-radius:0 0 4px 4px;color:#ff934d}
.row-menu-list :disabled{opacity:.5;cursor:wait}
/* A row with \`className: 'row-menu-new'\` leads the list as an action, set apart by a line. */
.row-menu-row.row-menu-new{margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #414141}
.row-menu-row.row-menu-new .row-menu-load{color:#ffad80}
.row-menu-toggle .row-menu-modified{flex:0 0 auto;margin:0 auto 0 -2px;color:#ff934d;font-weight:700}
/* With a mouse, a row's delete cross shows while the row is hovered or focused. */
@media(hover:hover){.row-menu-row:not(:hover):not(:focus-within) .row-menu-delete:not(.is-armed){visibility:hidden}}
`;
let menus = 0;

// `confirm` (a short label such as 'Delete?') makes delete a two-step action.
export function createRowMenu({ className = '', label, empty = '', placeholder = '', deleteLabel = name => `Delete ${name}`, confirm = '', onSelect, onDelete, footer = null }) {
  if (!document.getElementById('row-menu-styles')) {
    const style = document.createElement('style'); style.id = 'row-menu-styles'; style.textContent = STYLES; document.head.append(style);
  }
  const id = `row-menu-${++menus}`;
  const wrap = document.createElement('div'); wrap.className = `row-menu ${className}`.trim();
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'row-menu-toggle';
  toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', id);
  toggle.dataset.scdlTooltip = label; toggle.setAttribute('aria-label', label);
  const value = document.createElement('span'); value.className = 'row-menu-value';
  // Unsaved changes, like the asterisk in FL Studio's title bar.
  const modified = document.createElement('span'); modified.className = 'row-menu-modified'; modified.textContent = '*'; modified.hidden = true;
  toggle.append(value, modified);
  toggle.insertAdjacentHTML('beforeend', '<sc-icon name="down" aria-hidden="true"></sc-icon>');
  const menu = document.createElement('div'); menu.className = 'row-menu-list'; menu.id = id;
  menu.popover = 'auto'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
  wrap.append(toggle, menu);
  let items = [], current = null, busy = false, disabled = false;
  const isOpen = () => { try { return menu.matches(':popover-open'); } catch { return false; } };
  function place() {
    const box = toggle.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(180, box.width)}px`;
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8))}px`;
    const below = box.bottom + 4, above = box.top - menu.offsetHeight - 4;
    menu.style.top = `${below + menu.offsetHeight <= innerHeight - 8 || above < 8 ? Math.min(below, innerHeight - menu.offsetHeight - 8) : above}px`;
  }
  function render() {
    const chosen = items.find(item => item.id === current);
    value.textContent = chosen?.name ?? placeholder;
    toggle.disabled = disabled;
    const rows = items.map(item => {
      const row = document.createElement('div'); row.className = `row-menu-row ${item.className || ''}`.trim(); row.dataset.id = item.id;
      const load = document.createElement('button'); load.type = 'button'; load.className = 'row-menu-load';
      load.setAttribute('role', 'menuitemradio'); load.setAttribute('aria-checked', String(item.id === current));
      load.textContent = item.name; load.dataset.scdlTooltip = item.title || item.name;
      load.onclick = () => { close(); if (item.id !== current) onSelect?.(item.id); };
      row.append(load);
      if (onDelete && item.deletable !== false) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'row-menu-delete';
        remove.replaceChildren(globalThis.SCIcons.create('close')); remove.dataset.scdlTooltip = deleteLabel(item.name); remove.setAttribute('aria-label', remove.dataset.scdlTooltip);
        const disarm = () => { delete remove.dataset.armed; remove.classList.remove('is-armed'); remove.replaceChildren(globalThis.SCIcons.create('close')); remove.setAttribute('aria-label', remove.dataset.scdlTooltip); };
        remove.onclick = event => {
          event.stopPropagation();
          if (confirm && !remove.dataset.armed) {
            remove.dataset.armed = 'true'; remove.classList.add('is-armed'); remove.textContent = confirm;
            remove.setAttribute('aria-label', `${confirm} ${item.name}`); return;
          }
          disarm(); onDelete(item.id);
        };
        remove.onblur = disarm; row.onmouseleave = disarm;
        row.append(remove);
      }
      return row;
    });
    if (!items.length && empty) { const note = document.createElement('p'); note.textContent = empty; rows.push(note); }
    if (footer) {
      const action = document.createElement('button'); action.type = 'button'; action.className = 'row-menu-footer';
      action.setAttribute('role', 'menuitem'); action.textContent = footer.label;
      action.onclick = () => { close(); footer.action(); };
      rows.push(action);
    }
    menu.replaceChildren(...rows);
    for (const control of menu.querySelectorAll('button')) control.disabled = busy;
    menu.setAttribute('aria-busy', String(busy));
    if (isOpen()) place();
  }
  function open() {
    if (disabled || isOpen()) return;
    render(); menu.showPopover(); place();
    (menu.querySelector('.row-menu-load[aria-checked=true]') || menu.querySelector('button'))?.focus({ preventScroll: true });
  }
  function close() { if (isOpen()) menu.hidePopover(); }
  toggle.addEventListener('click', () => { if (isOpen()) close(); else open(); });
  toggle.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
  menu.addEventListener('toggle', event => {
    const opened = event.newState === 'open';
    toggle.setAttribute('aria-expanded', String(opened));
    if (!opened && menu.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  });
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('.row-menu-load, .row-menu-footer')].filter(button => !button.disabled);
    const index = buttons.indexOf(document.activeElement.closest('.row-menu-row')?.querySelector('.row-menu-load') || document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
    } else if (event.key === 'Delete' && onDelete) {
      const row = document.activeElement.closest('.row-menu-row');
      if (row) { event.preventDefault(); row.querySelector('.row-menu-delete')?.click(); }
    } else if (event.key === 'Tab') close();
    // The menu owns its keys: pads, Playlist hotkeys and Space stay out.
    event.stopPropagation();
  });
  window.addEventListener('resize', () => { if (isOpen()) place(); });
  render();
  return {
    element: wrap, toggle, menu,
    // [{ id, name, title?, deletable?, className? }]
    setItems(list) { items = list.map(item => ({ ...item })); render(); },
    setValue(id) { current = id ?? null; toggle.value = current ?? ''; render(); },
    setPlaceholder(text) { placeholder = text; render(); },
    setModified(value, label = '') { modified.hidden = !value; modified.dataset.scdlTooltip = label; modified.setAttribute('aria-label', label); },
    value: () => current,
    setDisabled(value) { disabled = !!value; if (disabled) close(); render(); },
    setBusy(value) { busy = !!value; render(); },
    open, close, isOpen,
  };
}
