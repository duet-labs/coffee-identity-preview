import {createIdentitySession} from './identity-session.mjs?v=d775dfaf2b2c';

const config = window.COFFEE_CONFIG;
const start = document.getElementById('start-chat');
const fresh = document.getElementById('fresh-chat');
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const form = document.getElementById('registration');
const submit = document.getElementById('register-submit');
const switchAccount = document.getElementById('switch-account');
let session, widgetReady = false, widgetLoading, widgetFailed = false, lastAuthRefresh=0;

function unavailable(expired = true) {
  if (expired) { start.disabled = true; fresh.disabled = true; }
  status.textContent = 'We could not connect. Please try again in a moment.';
  retry.hidden = false;
}

async function boot() {
  if (!config?.apiUrl || !config.decagonSlug || !config.decagonLoaderUrl) throw new Error('configuration_missing');
  const preview = config.environment === 'identity-preview';
  const batchPreview = preview && config.previewKind === 'batch';
  const crossPreview = preview && config.previewKind === 'cross-browser';
  if (preview && (!config.decagonBranch || !config.apiUrl.endsWith(crossPreview ? '/coffee-cross-preview' : batchPreview ? '/coffee-batch-preview' : '/coffee-identity-preview'))) throw new Error('preview_configuration_invalid');
  if (preview) {
    const emailInput = document.getElementById('email');
    emailInput.readOnly = !crossPreview;
    emailInput.autocomplete = 'off';
    document.getElementById('email-label').textContent = 'Test email';
    document.getElementById('registration-intro').textContent = crossPreview
      ? 'Use the same test email on another browser to return to your test account.'
      : 'Use a test name and company. This preview uses a generated test email and a separate order queue.';
  }
  let registrationMessage = '';
  document.getElementById('event-name').textContent = config.eventName;
  document.getElementById('event-subtitle').textContent = config.eventSubtitle;
  const key = crossPreview ? 'decagon-coffee-us-2950-cross-preview-token' : batchPreview ? 'decagon-coffee-us-2950-batch-preview-token' : preview ? 'decagon-coffee-us-2950-identity-preview-token' : 'decagon-coffee-us-2950-browser-token';
  let token;
  try { token = localStorage.getItem(key); } catch {}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token || '')) {
    token = crypto.randomUUID();
    try { localStorage.setItem(key, token); } catch {}
  }
  async function api(path, fields = {}) {
    const response = await fetch(`${config.apiUrl}/${path}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...fields, browser_token: token, client_version:3}), signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'service_unavailable');
    return data;
  }
  let needsProfile=false;
  const profileFields=show=>{
    document.getElementById('profile-fields').hidden=!show;
    for(const id of ['name','company']) {
      document.getElementById(id).required=show;
      document.getElementById(id).disabled=!show;
    }
  };
  const restart=()=>{
    token=crypto.randomUUID();
    try { localStorage.setItem(key,token); } catch {}
    location.reload();
  };
  switchAccount.onclick=async()=>{
    switchAccount.disabled=true;
    try {
      await api('session/end');
      session.stop();
      restart();
    } catch {
      status.textContent='We could not sign out. Please try again.';
      switchAccount.disabled=false;
    }
  };
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
        let settled=false;
        const timer = setTimeout(() => {settled=true;reject(new Error('widget_timeout'));}, 20000);
        const script = document.createElement('script');
        script.src = config.decagonLoaderUrl;
        script.dataset.slug = config.decagonSlug;
        script.async = true;
        script.onerror = () => { clearTimeout(timer); reject(new Error('widget_unavailable')); };
        script.onload = () => {
          if (!window.duet) { clearTimeout(timer); reject(new Error('widget_unavailable')); return; }
          const ready=()=>{
            if(settled || widgetReady)return;
            settled=true;clearTimeout(timer);
            window.duet.setUserIdAuth(identity.signature,identity.epoch);
            window.duet.setUserId(identity.user_id,false);
            window.duet.addMetadata(metadata(identity));
            widgetReady=true;resolve();
          };
          window.duet.setEventListener(event => {
            if(event.eventName==='DUET_AUTH_FAILED') {
              if(Date.now()-lastAuthRefresh<5000)return;
              lastAuthRefresh=Date.now();
              void session.refresh().catch(()=>{});
              return;
            }
            if(event.eventName==='DECAGON_LOADED')ready();
          });
          // The deployed loader exposes isReady(); its event can precede this
          // script's onload callback when resources are already cached.
          if(window.duet.isReady?.())ready();
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
      if (!widgetReady && (preview || identity.registration_required) && identity.registration_status === 'unregistered') {
        form.hidden = false;
        profileFields(!identity.cross_browser || needsProfile);
        if(identity.cross_browser && !preview)document.getElementById('registration-intro').textContent='Enter your email to start or return to your coffee account.';
        const emailInput = document.getElementById('email');
        if (preview && !/^coffee-preview-[a-z0-9-]{8,64}@example\.invalid$/.test(emailInput.value)) {
          emailInput.value = `coffee-preview-${crypto.randomUUID()}@example.invalid`;
        }
        start.hidden = true;
        status.textContent = registrationMessage || (preview ? 'Preview: use a test email ending in @example.invalid.' : identity.cross_browser ? 'Your coffee account works across browsers and devices.' : 'Enter your details once to start ordering.');
        retry.hidden = true;
        return;
      }
      form.hidden = true;
      start.hidden = false;
      if (!widgetReady) await loadWidget(identity);
      else {
        window.duet.setUserIdAuth(identity.signature, identity.epoch);
        window.duet.addMetadata(metadata(identity));
      }
      start.textContent = 'Start conversation →';
      start.disabled = false;
      fresh.hidden = false;
      fresh.disabled = false;
      switchAccount.hidden=!identity.cross_browser;
      status.textContent = preview ? 'Preview: orders go to a separate test queue.' : '';
      retry.hidden = true;
    },
    onUnavailable: ({expired,error}) => {
      unavailable(expired);
      if(error==='identity_migration_pending') {
        start.disabled=true;fresh.disabled=true;
        status.textContent='Your coffee chat history is being updated. Please try again later or order at the counter.';
      }
      if(error==='client_upgrade_required') {
        session.stop();retry.textContent='Reload page';retry.onclick=()=>location.reload();
      }
      if(error==='session_expired') {
        session.stop();
        status.textContent='This browser is signed out. Enter your email again to continue.';
        retry.textContent='Continue with email';retry.onclick=restart;
      }
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
    let saved=false;
    try {
      await api('register', Object.fromEntries(new FormData(form)));
      saved=true;
      registrationMessage='';
      // No signed widget exists yet. Keep the in-memory token if storage is
      // unavailable, including private browsers, instead of losing it on reload.
      const updated=await session.refresh();
      // An automatic refresh may have started before registration completed.
      if(updated?.registration_status==='unregistered')await session.refresh();
    } catch (error) {
      if(saved) {
        status.textContent='Your details are saved, but chat could not connect. Please try again.';
        retry.hidden=false;submit.disabled=false;
        return;
      }
      if(error.message==='profile_required') {
        needsProfile=true;profileFields(true);
        registrationMessage='Welcome! Add your name and company to finish signing up.';
        status.textContent=registrationMessage;submit.disabled=false;
        document.getElementById('name').focus?.();
        return;
      }
      const messages = {
        registration_email_in_use: 'This email cannot be used here yet. Please ask at the counter for help.',
        browser_email_change_not_allowed: 'This browser is already registered with another email. Please reload to continue.',
        preview_email_required: 'Use the suggested coffee-preview test email ending in @example.invalid.',
        registration_rate_limited: 'Too many registrations. Please try again in a few minutes.',
        registration_not_enabled: 'Registration is paused. Please ask at the counter for help.',
        identity_email_unavailable: 'We could not register that email. Please ask at the counter for help.',
        client_upgrade_required: 'Please reload this page to continue.',
      };
      registrationMessage = messages[error.message] || 'We could not save your details. Please try again.';
      status.textContent = registrationMessage;
      submit.disabled = false;
    }
  };
  retry.onclick = () => { void session.refresh().catch(() => unavailable()); };
  const open = async newConversation => {
    try {
      // Re-read registration before opening a new chat, including legacy form callbacks.
      await session.refresh();
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
