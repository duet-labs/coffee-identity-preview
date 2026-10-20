// One refresh owner per page. Identity changes are handled separately from renewal.
export function createIdentitySession({load, apply, onUnavailable, onIdentityChange,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout}) {
  let current, expiresAt = 0, refreshAt = 0, timer, pending, stopped = false, failures = 0;
  const cancel = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
  function schedule(delay) {
    cancel();
    if (!stopped) timer = setTimer(() => { void refresh().catch(() => {}); }, Math.max(1000, delay));
  }
  async function perform() {
    try {
      const identity = await load();
      const awaitingRegistration=identity?.registration_required===true && identity.registration_status==='unregistered';
      if (!identity?.ok || !identity.user_id || (!identity.signature && !awaitingRegistration) || !Number.isInteger(identity.epoch)
        || !Number.isInteger(identity.server_time) || identity.epoch <= identity.server_time
        || !['registered', 'unregistered'].includes(identity.registration_status)) throw new Error('identity_unavailable');
      if (stopped) return current;
      // Registration may select an identity before any signed widget is loaded.
      const firstRegistration=current?.registration_required===true
        && current.registration_status==='unregistered' && !current.signature;
      if (current && identity.user_id !== current.user_id && !firstRegistration) {
        stopped = true;
        cancel();
        onIdentityChange(identity);
        throw new Error('identity_changed');
      }
      const lifetime = (identity.epoch - identity.server_time) * 1000;
      expiresAt = now() + lifetime;
      refreshAt = expiresAt - Math.min(300000, lifetime / 4);
      await apply(identity, current);
      current = identity;
      failures = 0;
      schedule(refreshAt - now());
      return identity;
    } catch (error) {
      if (!stopped) {
        onUnavailable({expired: !current || now() >= expiresAt, error: error.message});
        schedule(Math.min(60000, 1000 * 2 ** Math.min(failures++, 6)));
      }
      throw error;
    }
  }
  function refresh() {
    if (stopped) return Promise.reject(new Error('identity_session_stopped'));
    if (!pending) {
      cancel();
      pending = perform().finally(() => { pending = undefined; });
    }
    return pending;
  }
  return {
    refresh,
    ensureFresh: () => !current || now() >= refreshAt ? refresh() : Promise.resolve(current),
    stop: () => { stopped = true; cancel(); },
    get current() { return current; },
  };
}
