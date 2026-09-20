let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, ms = 2400): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('on'), ms);
}
