import {createIdentitySession} from './identity-session.mjs?v=3b282642034d';

const config = window.COFFEE_CONFIG;
const start = document.getElementById('start-chat');
const fresh = document.getElementById('fresh-chat');
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const form = document.getElementById('registration');
const submit = document.getElementById('register-submit');
let session, widgetReady = false, widgetLoading, widgetFailed = false;

function unavailable(expired = true) {
  if (expired) { start.disabled = true; fresh.disabled = true; }
  status.textContent = 'We could not connect. Please try again in a moment.';
  retry.hidden = false;
}

async function boot() {
  if (!config?.apiUrl || !config.decagonSlug || !config.decagonLoaderUrl) throw new Error('configuration_missing');
  const preview = config.environment === 'identity-preview';
  if (preview && (!config.decagonBranch || !config.apiUrl.endsWith('/coffee-identity-preview'))) throw new Error('preview_configuration_invalid');
  if (preview) {
    const emailInput = document.getElementById('email');
    emailInput.readOnly = true;
    emailInput.autocomplete = 'off';
    document.getElementById('email-label').textContent = 'Test email';
    document.getElementById('registration-intro').textContent = 'Use a test name and company. This preview uses a generated test email and a separate order queue.';
  }
  let registrationMessage = '';
  document.getElementById('event-name').textContent = config.eventName;
  document.getElementById('event-subtitle').textContent = config.eventSubtitle;
  const key = preview ? 'decagon-coffee-us-2950-identity-preview-token' : 'decagon-coffee-us-2950-browser-token';
  let token;
  try { token = localStorage.getItem(key); } catch {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token || '')) {
    token = crypto.randomUUID();
    try { localStorage.setItem(key, token); } catch {}
  }
  async function api(path, fields = {}) {
    const response = await fetch(`${config.apiUrl}/${path}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...fields, browser_token: token}), signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'service_unavailable');
    return data;
  }
  function metadata(identity) {
    return {browser_token: token, email: identity.email || '', name: identity.name || '',
      firstName: identity.first_name || '', company: identity.company || '',
      registration_status: identity.registration_status,
      ...(preview ? {_decagon_branch_name: config.decagonBranch} : {}),
    };
  }
  async function loadWidget(identity) {
    if (widgetLoading) return widgetLoading;
    widgetLoading = (async () => {
      if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, {once: true}));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('widget_timeout')), 20000);
        const script = document.createElement('script');
        script.src = config.decagonLoaderUrl;
        script.dataset.slug = config.decagonSlug;
        script.async = true;
        script.onerror = () => { clearTimeout(timer); reject(new Error('widget_unavailable')); };
        script.onload = () => {
          if (!window.duet) { clearTimeout(timer); reject(new Error('widget_unavailable')); return; }
          window.duet.setEventListener(event => {
            if (event.eventName !== 'DECAGON_LOADED' || widgetReady) return;
            clearTimeout(timer);
            window.duet.setUserIdAuth(identity.signature, identity.epoch);
            window.duet.setUserId(identity.user_id, false);
            window.duet.addMetadata(metadata(identity));
            widgetReady = true;
            resolve();
          });
        };
        document.head.appendChild(script);
      });
    })().catch(error => { widgetFailed = true; throw error; });
    return widgetLoading;
  }
  session = createIdentitySession({
    load: () => api('identity'),
    apply: async identity => {
      if (preview && identity.environment !== 'identity-preview') throw new Error('preview_backend_mismatch');
      if (!widgetReady && preview && identity.registration_status === 'unregistered') {
        form.hidden = false;
        const emailInput = document.getElementById('email');
        if (!/^coffee-preview-[a-z0-9-]{8,64}@example\.invalid$/.test(emailInput.value)) {
          emailInput.value = `coffee-preview-${crypto.randomUUID()}@example.invalid`;
        }
        start.hidden = true;
        status.textContent = registrationMessage || 'Preview: your test email is generated automatically.';
        retry.hidden = true;
        return;
      }
      form.hidden = true;
      start.hidden = false;
      if (!widgetReady) await loadWidget(identity);
      else window.duet.setUserIdAuth(identity.signature, identity.epoch);
      start.textContent = 'Start conversation →';
      start.disabled = false;
      fresh.hidden = false;
      fresh.disabled = false;
      status.textContent = preview ? 'Preview: orders go to a separate test queue.' : '';
      retry.hidden = true;
    },
    onUnavailable: ({expired}) => {
      unavailable(expired);
      if (widgetFailed) {
        session.stop();
        retry.onclick = () => location.reload();
      }
    },
    onIdentityChange: () => {
      start.disabled = true;
      fresh.disabled = true;
      status.textContent = 'Your coffee profile changed. Finish your current conversation, then reload this page.';
      retry.textContent = 'Reload page';
      retry.hidden = false;
      retry.onclick = () => location.reload();
    },
  });
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    registrationMessage = 'Saving your details…';
    status.textContent = registrationMessage;
    try {
      await api('register', Object.fromEntries(new FormData(form)));
      // No widget or conversation exists yet. Reload resolves the saved profile.
      location.reload();
    } catch (error) {
      const messages = {
        registration_email_in_use: 'That email is already registered in another browser. Please use the original browser.',
        browser_email_change_not_allowed: 'This browser is already registered with another email. Please reload to continue.',
        preview_email_required: 'Use the suggested coffee-preview test email ending in @example.invalid.',
        registration_rate_limited: 'Too many registrations. Please try again in a few minutes.',
      };
      registrationMessage = messages[error.message] || 'We could not save your details. Please try again.';
      status.textContent = registrationMessage;
      submit.disabled = false;
    }
  };
  retry.onclick = () => { void session.refresh().catch(() => unavailable()); };
  const open = async newConversation => {
    try {
      await session.ensureFresh();
      if (newConversation) window.duet.startNewConversation();
      window.duet.open();
    } catch { unavailable(); }
  };
  start.onclick = () => open(false);
  fresh.onclick = () => open(true);
  const resume = () => { if (document.visibilityState !== 'hidden') void session.ensureFresh().catch(() => {}); };
  document.addEventListener('visibilitychange', resume);
  for (const event of ['focus', 'pageshow', 'online']) window.addEventListener(event, resume);
  await session.refresh();
}

boot().catch(() => unavailable());
