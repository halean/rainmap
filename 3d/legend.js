// Share the main rainmap's saved preference on the same origin.
(() => {
  const key = 'hcmcRainMap.legendHidden';
  const panel = document.getElementById('map-legend');
  const close = document.getElementById('legend-close');
  const reopen = document.getElementById('legend-reopen');
  function setVisible(visible, focus = false) {
    panel.hidden = !visible;
    reopen.hidden = visible;
    reopen.setAttribute('aria-expanded', String(visible));
    try { localStorage.setItem(key, visible ? '0' : '1'); } catch {}
    if (focus) (visible ? close : reopen).focus({preventScroll:true});
  }
  let hidden = false;
  try { hidden = localStorage.getItem(key) === '1'; } catch {}
  setVisible(!hidden);
  close.addEventListener('click', () => setVisible(false, true));
  reopen.addEventListener('click', () => setVisible(true, true));
})();
