import { useEffect, useRef } from 'react';
type HC = { render: (el: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { hcaptcha?: HC; stCaptchaReady?: () => void } }
export default function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || widget || !host.current || !window.hcaptcha) return;
      widget = window.hcaptcha.render(host.current, {
        sitekey: import.meta.env.VITE_HCAPTCHA_SITE_KEY, theme: 'dark',
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(''), 'error-callback': () => callback.current('')
      });
    };
    window.stCaptchaReady = render;
    let script = document.querySelector<HTMLScriptElement>('#hcaptcha-loader');
    if (!script) { script = document.createElement('script'); script.id = 'hcaptcha-loader'; script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=stCaptchaReady'; script.async = true; document.head.appendChild(script); }
    script.addEventListener('load', render);
    render();
    return () => { cancelled = true; script.removeEventListener('load', render); if (widget) window.hcaptcha?.remove(widget); };
  }, []);
  return <div className="captcha" ref={host} />;
}
