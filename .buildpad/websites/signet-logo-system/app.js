// Signet logo system — interactivity

document.addEventListener('DOMContentLoaded', () => {

  // Copy-to-clipboard for SVG export blocks
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-copy-target');
      const el = document.getElementById(targetId);
      if (!el) return;
      const text = el.innerText;
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('text-[var(--gold)]');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('text-[var(--gold)]');
        }, 1400);
      } catch (err) {
        btn.textContent = 'Select & copy manually';
        setTimeout(() => { btn.textContent = 'Copy SVG'; }, 1800);
      }
    });
  });

  // Accent proof demo — only the UI swatch button changes, the logo mark never does
  const accentBtn = document.getElementById('accent-demo-btn');
  const swatches = document.querySelectorAll('#accent-swatches button');

  function contrastTextColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#0c0a08' : '#f2ede6';
  }

  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      const color = sw.getAttribute('data-accent');
      if (accentBtn) {
        accentBtn.style.background = color;
        accentBtn.style.color = contrastTextColor(color);
      }
      swatches.forEach((s) => s.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#1b1815]'));
      sw.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#1b1815]');
    });
  });
});
