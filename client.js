/**
 * Browser half: one balance chip in the sidebar footer.
 *
 * Balance data comes from the account Remote namespace (`account.getBalance`),
 * the same Host query the Account settings page uses. A balance is only
 * reported while a DeepSeek account credential is stored, so the chip
 * subscribes to `account.watch` to follow sign-in/sign-out and re-reads on
 * click.
 *
 * Two host patterns are copied rather than imported, because a plain-JS client
 * plugin must not require a Harness Client package:
 *  - the `Tooltip` primitive: a `position: fixed` bubble whose coordinates come
 *    from the anchor's `getBoundingClientRect()`. The sidebar column is
 *    `overflow: hidden` and this composition has no portal service, so only a
 *    fixed bubble escapes the clip. Styling mirrors Tooltip.module.css.
 *  - the `ContextMeter` ring: a 14px viewBox circle at r=5.5 with a 2px stroke,
 *    filled by `stroke-dasharray`. Here it reports the balance remaining against
 *    a baseline the user sets, and turns red once a threshold they set is
 *    reached. Both numbers are user-owned: the plugin never invents a
 *    denominator, so nothing it shows depends on a guess about their spending.
 *
 * Styling uses theme tokens only, and the framework hands the component its
 * `t` seat plus the slot's `wide` owner prop.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-usage-balance',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

    /** Client build version reported to the Host as the calling UI's identity. */
    const CLIENT_VERSION = '0.2.0-rc.2';
    /** Locale namespace owned by this plugin. */
    const NS = 'usageBalance';
    /** Slot this plugin renders into (list slot declared by ui-sidebar). */
    const SLOT = 'sidebar.footer.action';
    /** localStorage key holding the per-currency alert thresholds. */
    const STORAGE_KEY = 'dsh-usage-balance:thresholds';
    /** localStorage key holding the per-currency ring denominators. */
    const BASELINE_KEY = 'dsh-usage-balance:baselines';

    /** Recharge-wallet read states the chip distinguishes. */
    const LOADING = { phase: 'loading' };
    const SIGNED_OUT = { phase: 'signed-out' };
    const FAILED = { phase: 'failed' };

    const zh = {
      'chip.label': '余额',
      'chip.refresh': '刷新余额',
      'chip.signedOut': '登录后查看',
      'chip.failed': '读取失败',
      'chip.empty': '未充值',
      'tooltip.balance': '充值余额',
      'tooltip.bonus': '赠金余额',
      'tooltip.hint': '点击刷新余额',
      'tooltip.alerts': '余额预警',
      'tooltip.alertReached': '已达阈值',
      'tooltip.alertHint': 'Alt + 点击查看详情',
      'tooltip.alertHintMac': 'Option + 点击查看详情',
      'tooltip.signedOut': '登录 DeepSeek 账号后可查看余额',
      'tooltip.failed': '余额读取失败，点击重试',
      'panel.title': '余额',
      'panel.state': '状态',
      'panel.remaining': '剩余',
      'panel.threshold': '预警阈值',
      'panel.baseline': '余额基准',
      'panel.baselineShort': '基准',
      'panel.baselinePlaceholder': '如 100.00',
      'panel.useNow': '用当前余额',
      'panel.useNowHint': '把基准填成当前余额，剩余比例从 100% 开始',
      'panel.remainingValue': '{percent}%（{cents} / 基准 {baseline}）',
      'panel.needOne': '请至少填写基准或阈值',
      'panel.invalid': '{label}必须是大于 0 的数字',
      'panel.unsaved': '未保存',
      'ring.aria': '剩余 {percent}%，{left}',
      'alert.title': '余额预警',
      'alert.description': '余额达到该值时，余额旁的圆环变红。',
      'alert.placeholder': '如 10.00',
      'alert.save': '保存',
      'alert.clear': '清除',
      'alert.invalid': '请输入大于 0 的数字',
      'alert.ariaReached': '余额预警：已达阈值，剩余 {left}',
    };
    const en = {
      'chip.label': 'Balance',
      'chip.refresh': 'Refresh balance',
      'chip.signedOut': 'Sign in to view',
      'chip.failed': 'Unavailable',
      'chip.empty': 'No credit',
      'tooltip.balance': 'Topped-up balance',
      'tooltip.bonus': 'Granted balance',
      'tooltip.hint': 'Click to refresh',
      'tooltip.alerts': 'Balance alert',
      'tooltip.alertReached': 'Alert threshold reached',
      'tooltip.alertHint': 'Alt + click for details',
      'tooltip.alertHintMac': 'Option + click for details',
      'tooltip.signedOut': 'Sign in to your DeepSeek account to see the balance',
      'tooltip.failed': 'Could not read the balance — click to retry',
      'panel.title': 'Balance',
      'panel.state': 'State',
      'panel.remaining': 'Remaining',
      'panel.threshold': 'Alert threshold',
      'panel.baseline': 'Balance baseline',
      'panel.baselineShort': 'baseline',
      'panel.baselinePlaceholder': 'e.g. 100.00',
      'panel.useNow': 'Use current',
      'panel.useNowHint': 'Fill the baseline with the current balance, so the ring starts at 100%',
      'panel.remainingValue': '{percent}% ({cents} of {baseline} baseline)',
      'panel.needOne': 'Enter a baseline, a threshold, or both',
      'panel.invalid': '{label} must be a number greater than 0',
      'panel.unsaved': 'Unsaved',
      'ring.aria': '{percent}% remaining, {left}',
      'alert.title': 'Balance alert',
      'alert.description': 'The ring beside the balance turns red once credit reaches this value.',
      'alert.placeholder': 'e.g. 10.00',
      'alert.save': 'Save',
      'alert.clear': 'Clear',
      'alert.invalid': 'Enter a number greater than 0',
      'alert.ariaReached': 'Balance alert: threshold reached, {left} left',
    };

    const CSS = [
      '.dsh-balance-root{display:block;min-width:0;font-size:13px;line-height:22px}',
      '.dsh-balance-button{display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;box-sizing:border-box;',
      'border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;text-align:left;cursor:pointer;-webkit-app-region:no-drag}',
      '.dsh-balance-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-balance-button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dsh-balance-button[data-wide="false"]{justify-content:center;padding:4px;gap:0}',
      '.dsh-balance-button[data-failed="true"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-balance-glyph{flex:none;display:block}',
      '.dsh-balance-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'font-variant-numeric:tabular-nums}',
      '.dsh-balance-skeleton{flex:1 1 auto;height:12px;border-radius:6px;background:var(--dsw-alias-bg-skeleton)}',
      // Ring: ContextMeter geometry (14px viewBox, r 5.5, 2px stroke).
      '.dsh-balance-ring{flex:none;display:block}',
      '.dsh-balance-ring-track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}',
      '.dsh-balance-ring-fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}',
      '.dsh-balance-ring[data-alert="true"] .dsh-balance-ring-fill{stroke:var(--dsw-alias-state-error-primary)}',
      // The ring is the threshold control, so it reacts to the chip's hover.
      '.dsh-balance-ring{transition:opacity 120ms var(--ds-ease-in-out)}',
      '.dsh-balance-button:hover .dsh-balance-ring,.dsh-balance-button:focus-visible .dsh-balance-ring{opacity:.72}',
      '@media (prefers-reduced-motion:reduce){.dsh-balance-ring{transition:none}}',
      // Tooltip: Tooltip.module.css, painted fixed so the sidebar's overflow
      // clip and stacking context cannot hide it. One line, so no per-row
      // whitespace is involved.
      '.dsh-balance-tip{display:inline-flex;align-items:center;position:fixed;z-index:1100;width:max-content;',
      'max-width:50vw;box-sizing:border-box;padding:3px 7px;border-radius:var(--dsw-radius-sm);',
      'background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;',
      'line-height:20px;white-space:nowrap;overflow-wrap:break-word;pointer-events:none;',
      'animation:dsh-balance-in 150ms var(--ds-ease-in-out)}',
      '.dsh-balance-tip-text{display:block;min-width:0}',
      '@keyframes dsh-balance-in{from{opacity:0}}',
      '.dsh-balance-tip[data-side="top"]{transform:translate(-100%,-100%)}',
      '.dsh-balance-tip[data-side="bottom"]{transform:translateX(-100%)}',
      // Panel: rows of label/value figures, then the threshold field.
      // Input.module.css + Button.module.css (sm, primary/ghost) supply the rest.
      '.dsh-balance-editor{position:fixed;z-index:1100;box-sizing:border-box;width:min(236px,100vw - 24px);',
      'padding:12px;border:0;border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-secondary);',
      // The host paints every popover with these two, so the panel tracks the
      // same surfaces (menu, hover card, context meter) in both schemes.
      'background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));',
      'backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);',
      // Native bits of the field (caret, selection) follow the document scheme.
      'color-scheme:light dark;font-size:12px;line-height:20px}',
      '.dsh-balance-editor-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}',
      '.dsh-balance-editor-rows{margin-top:8px}',
      '.dsh-balance-editor-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:1px 0}',
      // The label must not wrap: a long value ("79%（¥11.86 / 基准 ¥15.09）") in a
      // flex row would otherwise break the label mid-phrase and push the value
      // into a second line, which reads as scrambled.
      '.dsh-balance-editor-label{color:var(--dsw-alias-label-tertiary);min-width:0;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis}',
      '.dsh-balance-editor-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;',
      'white-space:nowrap}',
      '.dsh-balance-editor-value[data-tone="alert-value-alert"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-balance-editor-section{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:10px;',
      'color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}',
      '.dsh-balance-editor-copy{color:var(--dsw-alias-label-tertiary);margin-top:2px}',
      '.dsh-balance-editor-field{margin-top:8px}',
      '.dsh-balance-editor-field-label{display:block;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}',
      '.dsh-balance-editor-input-shell{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;',
      'box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);',
      'background:var(--dsw-alias-bg-layer-1)}',
      '.dsh-balance-editor-input-shell:focus-within{border-color:var(--dsw-alias-state-business-primary)}',
      '.dsh-balance-editor-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}',
      '.dsh-balance-editor-input::placeholder{color:var(--dsw-alias-label-dimmed)}',
      // A quiet inline shortcut, not an action: it only fills the field above.
      '.dsh-balance-editor-mini{flex:none;border:0;background:0 0;padding:0 2px;color:var(--dsw-alias-state-business-primary);',
      'font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsh-balance-editor-mini:hover:not(:disabled){text-decoration:underline}',
      '.dsh-balance-editor-mini:disabled{color:var(--dsw-alias-label-dimmed);cursor:not-allowed}',
      '.dsh-balance-editor-mini:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsh-balance-editor-error{color:var(--dsw-alias-state-error-primary);margin-top:6px}',
      '.dsh-balance-editor-value[data-tone="unsaved"]{color:var(--dsw-alias-state-warn-primary)}',
      '.dsh-balance-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}',
      '.dsh-balance-editor-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;',
      'height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.dsh-balance-editor-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-balance-editor-button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsh-balance-editor-button[data-primary="true"]{background:var(--dsw-alias-button-primary-fill);',
      'color:var(--dsw-alias-label-primary-foreground)}',
      '.dsh-balance-editor-button[data-primary="true"]:hover{background:var(--dsw-alias-button-primary-hover)}',
      '@media (prefers-reduced-motion:reduce){.dsh-balance-tip{animation:none}}',
    ].join('');

    /** Install the plugin's stylesheet once per document. */
    function ensureStyles() {
      const tagId = '@local/dsh-usage-balance/chip.css';
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-usage-balance';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Normalize one amount the way the Host presents money. */
    function normalizeAmount(raw) {
      let text = String(raw ?? '').trim();
      if (text === '') return null;
      const negative = text.startsWith('-');
      if (negative || text.startsWith('+')) text = text.slice(1);
      const digits = text.replace(/[^0-9.]/g, '');
      const parts = digits.split('.');
      const integer = (parts[0] ?? '').replace(/^0+(?=\d)/, '') || '0';
      const fraction = (parts[1] ?? '') + '000000';
      const cents = Number(integer) * 100 + Number(fraction.slice(0, 2));
      const tail = fraction.slice(2).replace(/0+$/, '');
      return {
        cents: negative ? -cents : cents,
        leftover: tail.length > 0,
      };
    }

    /** Format one wallet value with the Host's Platform Web money rules. */
    function formatAmount(raw, symbol) {
      const amount = normalizeAmount(raw);
      if (amount === null) return '';
      const { cents, leftover } = amount;
      if (cents === 0) return leftover ? '<' + symbol + '0.01' : symbol + '0.00';
      if (cents < 0) return '-' + symbol + (cents > -1 ? '0.01' : formatCents(-cents));
      return symbol + formatCents(cents);
    }

    /** Render a positive cent count with two decimals and digit grouping. */
    function formatCents(cents) {
      const whole = Math.floor(cents / 100);
      const rest = cents % 100;
      return whole.toLocaleString('en-US') + '.' + String(rest).padStart(2, '0');
    }

    /** Currency symbol for a Host wallet currency code. */
    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '\u00a5';
    }

    /** Join every wallet amount in one list into one label. */
    function formatWallets(wallets) {
      const parts = [];
      for (const wallet of wallets ?? []) {
        const text = formatAmount(wallet.balance, symbolOf(wallet.currency));
        if (text !== '') parts.push(text);
      }
      return parts.join(' / ');
    }

    /** Whether at least one wallet holds a non-zero amount. */
    function hasPositive(wallets) {
      return (wallets ?? []).some((wallet) => {
        const amount = normalizeAmount(wallet.balance);
        return amount !== null && (amount.cents > 0 || amount.leftover);
      });
    }

    /**
     * The wallet line a chip shows. Recharge credit wins when it holds
     * something; otherwise granted credit; a zero amount only when both are
     * empty, exactly like the Account settings balance card.
     */
    function primaryAmount(balance) {
      if (balance === null || balance.status !== 'ready') return null;
      if (hasPositive(balance.value)) return formatWallets(balance.value);
      if (hasPositive(balance.bonusWallets)) return formatWallets(balance.bonusWallets);
      return formatWallets(balance.value) || formatWallets(bonusWalletsOf(balance));
    }

    /** Granted credit of a ready payload, or an empty list. */
    function bonusWalletsOf(balance) {
      return balance === null || balance.status !== 'ready' ? [] : balance.bonusWallets;
    }

    /**
     * Read a `{ CUR: cents }` map from local storage. Display-only state, so
     * device-local storage is the right home: it survives restarts without
     * writing to the profile's patch layer.
     *
     * Stored values are already cent integers. They must NOT be run back
     * through {@link normalizeAmount}, which parses a decimal string and would
     * multiply them by 100 on every read.
     * @param key - the storage key.
     * @returns a plain map of positive cent amounts; unreadable storage yields `{}`.
     */
    function readNumberMap(key) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return {};
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return {};
        const out = {};
        for (const [currency, value] of Object.entries(parsed)) {
          const cents = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN;
          if (cents > 0) out[currency] = cents;
        }
        return out;
      } catch (_error) {
        return {};
      }
    }

    /**
     * Write a `{ CUR: cents }` map, clearing the key when it is empty.
     * @param key - the storage key.
     * @param map - the amounts to store.
     */
    function writeNumberMap(key, map) {
      try {
        if (Object.keys(map).length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(map));
      } catch (_error) {
        // Storage can be unavailable (private mode): the chip still works, the
        // value just does not survive a reload.
      }
    }

    /** Alert thresholds by currency code, in cents. */
    function loadThresholds() {
      return readNumberMap(STORAGE_KEY);
    }

    /**
     * Persist one threshold, or clear it with a null value.
     * @param currency - currency code the threshold applies to.
     * @param cents - positive threshold in cents, or null to clear it.
     * @returns the stored map after the write.
     */
    function saveThreshold(currency, cents) {
      const next = loadThresholds();
      if (cents === null) delete next[currency];
      else next[currency] = cents;
      writeNumberMap(STORAGE_KEY, next);
      return next;
    }

    /** Ring denominators (high-water marks) by currency code, in cents. */
    function loadBaselines() {
      return readNumberMap(BASELINE_KEY);
    }

    /**
     * WALLET SCOPE — the one open decision.
     *
     * The ring's denominator is a high-water mark, so "recharge only" and
     * "recharge plus granted credit" differ in exactly one place: which wallets
     * the ring reads. Switching between the two scopes means changing the body
     * of this function and nothing else.
     *
     * - `'recharge'` (default): granted credit is ignored by the ring, so a
     *   bonus grant never raises the denominator and a bonus expiry never looks
     *   like spending. A bonus-only account shows no ring.
     * - `'total'`: every wallet counts. Semantics become "share of the highest
     *   total credit ever held", and an expiring grant lowers the ratio.
     * @returns the wallets the ring's denominator and numerator both read.
     */
    function ringScope() {
      return 'recharge';
    }

    /**
     * The wallets the ring reads for one currency.
     * @param balance - the ready balance payload.
     * @param currency - currency code to select.
     * @returns matching wallets, according to {@link ringScope}.
     */
    function ringWallets(balance, currency) {
      const scope = ringScope();
      const lists = scope === 'total'
        ? [balance.value ?? [], balance.bonusWallets ?? []]
        : [balance.value ?? []];
      const out = [];
      for (const wallet of lists.flat()) {
        if (wallet.currency === currency) out.push(wallet);
      }
      return out;
    }

    /**
     * The ring's numerator: the balance the baseline is measured against.
     * @param balance - the ready balance payload.
     * @param currency - currency code to total.
     * @returns the amount in cents.
     */
    function ringCents(balance, currency) {
      let cents = 0;
      for (const wallet of ringWallets(balance, currency)) {
        const amount = normalizeAmount(wallet.balance);
        if (amount !== null) cents += amount.cents;
      }
      return cents;
    }

    /**
     * Currencies the ring can report on: those holding a wallet in scope.
     * @param balance - the ready balance payload.
     * @returns distinct currency codes.
     */
    function ringCurrencies(balance) {
      const walletLists = ringScope() === 'total'
        ? [balance.value ?? [], balance.bonusWallets ?? []]
        : [balance.value ?? []];
      const out = [];
      for (const wallet of walletLists.flat()) {
        if (!out.includes(wallet.currency)) out.push(wallet.currency);
      }
      return out;
    }

    /**
     * The ring's numerator for a currency, or 0 without a ready balance.
     * @param balance - the ready balance payload, or null.
     * @param currency - currency code to total.
     * @returns the amount in cents.
     */
    function ringCentsOf(balance, currency) {
      if (balance === null || balance.status !== 'ready') return 0;
      return ringCents(balance, currency);
    }

    /**
     * Persist one baseline, or clear it with a null value. Denominators are
     * user-owned: nothing else ever writes one.
     * @param currency - currency code the baseline applies to.
     * @param cents - positive baseline in cents, or null to clear it.
     * @returns the stored baselines after the write.
     */
    function saveBaseline(currency, cents) {
      const next = loadBaselines();
      if (cents === null) delete next[currency];
      else next[currency] = cents;
      writeNumberMap(BASELINE_KEY, next);
      return next;
    }

    /**
     * Ring readings for one ready balance: one entry per currency the user has
     * configured. The fill is the remaining share of that baseline; the
     * threshold only decides the color.
     * @param balance - the ready balance payload, or null.
     * @param baselines - denominators by currency, in cents.
     * @param thresholds - alert thresholds by currency, in cents.
     * @returns ring entries for the configured currencies that hold a wallet.
     */
    function ringReadings(balance, baselines, thresholds) {
      if (balance === null || balance.status !== 'ready') return [];
      const out = [];
      for (const currency of Object.keys(baselines)) {
        const baseline = baselines[currency];
        if (baseline <= 0) continue;
        // A baseline for a currency that holds nothing in scope stays silent.
        if (ringWallets(balance, currency).length === 0) continue;
        const cents = ringCents(balance, currency);
        const threshold = thresholds[currency];
        out.push({
          currency,
          cents,
          baseline,
          threshold: threshold === undefined ? null : threshold,
          reached: threshold !== undefined && cents <= threshold,
        });
      }
      return out;
    }

    /**
     * Balance reader shared by the chip's registration.
     * @param ctx - client plugin context supplying `remote` and `locale`.
     * @returns the observable face the component subscribes to.
     */
    function createBalanceStore(ctx) {
      let state = LOADING;
      const listeners = new Set();
      let account = null;
      let running = null;
      let stream = null;
      /** Latest sign-in/sign-out revision `account.watch` reported. */
      let gen = 0;
      /** Revision whose read most recently started. */
      let held = 0;
      /** Calls waiting for a read, and those a finished read has served. */
      let waiting = 0;
      let served = 0;
      /** Monotonic read stamp; only the newest read may publish. */
      let stamp = 0;
      let newest = 0;
      /** Whether a read already reported that the Host holds no grant. */
      let signedOut = false;
      let disposed = false;

      const publish = (next) => {
        if (disposed || next === state) return;
        state = next;
        for (const listener of [...listeners]) listener();
      };

      /**
       * Read the balance for the account the Host currently holds, then
       * publish it. A read that is no longer the newest, or whose account
       * revision moved while the call was out, publishes nothing: whichever
       * party is newer owns the chip.
       * @param expected - account revision this read was issued for.
       * @param mine - read stamp this call claimed.
       */
      const read = async (expected, mine) => {
        const snapshot = ctx.locale.getSnapshot();
        let answer;
        try {
          answer = await ctx.remote.account.getBalance({
            version: CLIENT_VERSION,
            locale: snapshot.active,
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          });
        } catch (_error) {
          if (mine === newest && gen === expected) publish(FAILED);
          return;
        }
        if (mine !== newest || gen !== expected) return;
        if (!answer.ok) {
          publish(FAILED);
          return;
        }
        const balance = answer.value;
        if (balance === null) {
          signedOut = true;
          publish(SIGNED_OUT);
          return;
        }
        signedOut = false;
        if (balance.status !== 'ready') {
          publish(FAILED);
          return;
        }
        const value = primaryAmount(balance);
        publish(value === null
          ? { phase: 'ready', value: null, balance }
          : { phase: 'ready', value, balance });
      };

      /**
       * Re-read the balance. Callers share one read chain, and the promise a
       * caller receives settles only after a read that started at or after
       * its own request, so clicking refresh never yields an older snapshot.
       * A Host already known to hold no grant answers from state.
       * @param force - read even though the Host already reported no grant.
       * @returns a promise settling after this call's read is covered.
       */
      const request = (force) => {
        if (disposed) return Promise.resolve();
        if (!force && signedOut) {
          publish(SIGNED_OUT);
          return Promise.resolve();
        }
        if (account !== null && account.status !== 'credential-stored') {
          publish(SIGNED_OUT);
          return Promise.resolve();
        }
        waiting += 1;
        const mine = waiting;
        if (running === null) {
          if (state.phase === 'loading') publish(LOADING);
          running = run();
        }
        const settled = running;
        // Wait until a read that started at or after this call has settled.
        return (async () => {
          while (!disposed && served < mine) await settled;
        })();
      };

      /**
       * Run the read chain. A read serves every call waiting when it starts;
       * a call arriving mid-read, or a sign-in/sign-out that moved the account
       * revision, earns exactly one more read. Only the newest read publishes,
       * so a throttled read cannot overwrite a fresher one.
       */
      async function run() {
        try {
          while (!disposed) {
            if (served >= waiting && gen === held) break;
            const anchor = waiting;
            const started = gen;
            stamp += 1;
            newest = stamp;
            await read(started, stamp);
            if (disposed) break;
            served = Math.max(served, anchor);
            if (gen === started) held = gen;
          }
        } finally {
          running = null;
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        /**
         * Adopt one account snapshot from `account.watch`. Only a *sign-in or
         * sign-out* moves the revision: a frame that re-reports the same
         * credential leaves reads in flight, so a refresh is never dropped by
         * an unrelated reconnect frame.
         * @param next - complete account state, or null when it is unknown.
         */
        setAccount(next) {
          if (disposed) return;
          const was = account;
          const wasIn = was !== null && was.status === 'credential-stored';
          const isIn = next !== null && next.status === 'credential-stored';
          account = next;
          if (wasIn === isIn) return;
          gen += 1;
          if (!isIn) {
            held = gen;
            running = null;
            signedOut = true;
            publish(SIGNED_OUT);
            return;
          }
          if (state.phase === 'loading') publish(LOADING);
          request(true);
        },
        /**
         * Re-read on demand: chip mount, click, or a returned top-up.
         * @param force - read even though the Host already reported no grant
         * (an explicit click, which is how the user asks after signing in).
         */
        refresh(force) {
          if (disposed) return Promise.resolve();
          if (!force && account !== null && account.status !== 'credential-stored') {
            publish(SIGNED_OUT);
            return Promise.resolve();
          }
          return request(force);
        },
        /** Open the account stream and fold every frame into this store. */
        start() {
          stream = ctx.remote.$stream({
            name: 'account',
            open: (signal) => ctx.remote.account.watch(signal),
            ended: () => new Error('account stream ended'),
          });
          (async () => {
            try {
              for await (const frame of stream) {
                if (disposed) return;
                this.setAccount(frame.value);
                frame.accept();
              }
            } catch (_error) {
              if (!disposed) this.setAccount(null);
            }
          })();
          return () => {
            if (stream !== null) stream.dispose();
          };
        },
        dispose() {
          disposed = true;
          listeners.clear();
          stream = null;
        },
      };
    }

    /**
     * Wallet glyph, drawn in `currentColor` so it follows the theme.
     * @returns the inline SVG element.
     */
    function Glyph() {
      return React.createElement('svg', {
        className: 'dsh-balance-glyph',
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        'aria-hidden': true,
        focusable: false,
      }, [
        React.createElement('rect', {
          key: 'body', x: 1.25, y: 3.25, width: 13.5, height: 9.5, rx: 2.25,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
        }),
        React.createElement('path', {
          key: 'flap', d: 'M4.4 3.4h6.2c.9 0 1.4.5 1.5 1.1H4.6c-.9 0-1.5.4-1.9.9',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
        }),
        React.createElement('circle', { key: 'dot', cx: 11.3, cy: 8, r: 1.15, fill: 'currentColor' }),
      ]);
    }

    /** Ring geometry, copied from the composer's ContextMeter. */
    const RING_RADIUS = 5.5;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    /**
     * Remaining-share ring. The fill is the balance as a share of its
     * high-water baseline, so it drains as credit is spent and refills when a
     * top-up raises the baseline; a configured threshold only decides the
     * color. The track is always drawn so the chip keeps its shape.
     * @param props.reading - ring entry for the ring's currency.
     * @param props.t - translate seat.
     * @returns the ring element, or null without a reading.
     */
    function BalanceRing({ reading, t }) {
      if (reading === undefined || reading === null) return null;
      const percent = Math.max(0, Math.min(100, Math.round(reading.cents / reading.baseline * 100)));
      const left = formatAmount(String(reading.cents / 100), symbolOf(reading.currency));
      const label = reading.reached
        ? t('alert.ariaReached', { left })
        : t('ring.aria', { percent: String(percent), left });
      return React.createElement('svg', {
        className: 'dsh-balance-ring',
        'data-alert': String(reading.reached),
        'data-percent': String(percent),
        viewBox: '0 0 14 14',
        width: 14,
        height: 14,
        role: 'img',
        'aria-label': label,
      }, [
        React.createElement('circle', {
          key: 'track', className: 'dsh-balance-ring-track', cx: 7, cy: 7, r: RING_RADIUS,
        }),
        React.createElement('circle', {
          key: 'fill',
          className: 'dsh-balance-ring-fill',
          cx: 7,
          cy: 7,
          r: RING_RADIUS,
          strokeDasharray: (RING_CIRCUMFERENCE * percent / 100) + ' ' + RING_CIRCUMFERENCE,
          transform: 'rotate(-90 7 7)',
        }),
      ]);
    }

    /** Placements the fixed bubble clamps to, mirroring the Tooltip primitive. */
    const EDGE_MARGIN = 12;
    const GAP = 8;

    /**
     * Compute the fixed coordinates for a bubble anchored above `el`. The
     * left value carries the anchor's right edge and the CSS transform pulls
     * the bubble fully left of it, mirroring the Tooltip primitive's
     * `align: 'end'` placement.
     * @param el - the anchor element.
     * @param width - the bubble's measured width.
     * @returns `{ left, top, width }` to paint, already viewport-clamped.
     */
    function placeAbove(el, width) {
      const r = el.getBoundingClientRect();
      const left = Math.max(EDGE_MARGIN, Math.min(r.right, window.innerWidth - EDGE_MARGIN - width));
      return { left, top: r.top - GAP, width };
    }

    /**
     * Host-styled tooltip bubble: fixed, so the sidebar's `overflow: hidden`
     * and stacking context cannot clip it. It paints at the anchor's top-right
     * on the first frame, then a layout effect measures and clamps it, exactly
     * like the Tooltip primitive's ResizeObserver pass.
     * @param props.anchor - element the bubble points at, or null while hidden.
     * @param props.children - bubble content.
     * @returns the bubble element, or null without an anchor.
     */
    function FixedBubble({ anchor, children }) {
      const bubble = useRef(null);

      useLayoutEffect(() => {
        const el = bubble.current;
        if (el === null) return;
        const fit = () => {
          if (anchor === null || anchor === undefined) return;
          const at = placeAbove(anchor, el.getBoundingClientRect().width);
          // Geometry is written straight to the node: fitting must never
          // re-render, or the effect would feed itself.
          el.style.left = (at.left + at.width) + 'px';
          el.style.top = at.top + 'px';
          el.dataset.fitted = 'true';
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
      }, [anchor]);

      if (anchor === null || anchor === undefined) return null;
      const r = anchor.getBoundingClientRect();
      return React.createElement('span', {
        ref: bubble,
        className: 'dsh-balance-tip',
        role: 'tooltip',
        'data-side': 'top',
        style: { left: r.right + 'px', top: (r.top - GAP) + 'px' },
      }, children);
    }

    /**
     * The chip's popover: the balance breakdown, the ring's baseline field and
     * the alert threshold field. It replaces a separate hover tooltip because a
     * multi-line bubble in this narrow column was hard to read, and because the
     * numbers a threshold is compared against are exactly the numbers the
     * reader needs. Fixed-positioned, since the sidebar clips in-flow children,
     * and it owns both drafts so a rejected value never reaches storage.
     * @param props.anchor - the chip element to anchor against.
     * @param props.balance - the ready balance payload, or null.
     * @param props.bonus - the granted-credit line, or null.
     * @param props.currency - the currency this panel edits.
     * @param props.readings - ring entries, one per configured currency.
     * @param props.onSave - receives `(currency, threshold, baseline)`, either
     * value null to clear it.
     * @param props.onClose - dismisses the panel.
     * @param props.t - translate seat.
     * @returns the panel element.
     */
    function ChipPanel({ anchor, balance, bonus, currency, readings, onSave, onClose, t }) {
      const ready = balance === null ? null : balance.status === 'ready' ? balance : null;
      const reading = readings.find((entry) => entry.currency === currency) ?? null;
      const thresholdValue = reading === null || reading.threshold === null ? '' : String(reading.threshold / 100);
      const baselineValue = reading === null ? '' : String(reading.baseline / 100);
      const [threshold, setThreshold] = useState(thresholdValue);
      const [baseline, setBaseline] = useState(baselineValue);
      const [error, setError] = useState(null);
      const [touched, setTouched] = useState(false);
      const panel = useRef(null);
      const input = useRef(null);

      // Focus once; geometry is written to the node so fitting never loops.
      // Guarded, because a non-browser host may hand back a bare element.
      useEffect(() => {
        const el = input.current;
        if (el !== null && el !== undefined && typeof el.focus === 'function') el.focus();
      }, []);

      useLayoutEffect(() => {
        const el = panel.current;
        if (el === null) return;
        const fit = () => {
          if (anchor === null || anchor === undefined) return;
          const at = placeAbove(anchor, el.getBoundingClientRect().width);
          el.style.left = (at.left + at.width) + 'px';
          el.style.top = at.top + 'px';
          el.dataset.fitted = 'true';
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
      }, [anchor]);

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        };
        const onPointerDown = (event) => {
          const el = panel.current;
          if (el !== null && !el.contains(event.target)) onClose();
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [onClose]);

      /**
       * Parse one field. Empty clears the value; a malformed or non-positive
       * entry is rejected and reported, never written.
       * @param raw - the field's text.
       * @param label - field label for the rejection message.
       * @returns `{ value }` in cents (null to clear), or `{ error }`.
       */
      const parse = (raw, label) => {
        const text = raw.trim();
        if (text === '') return { value: null };
        const amount = normalizeAmount(text);
        if (amount === null || amount.cents <= 0) {
          return { error: t('panel.invalid', { label }) };
        }
        return { value: amount.cents };
      };

      // Both fields commit together, so one Save never half-applies.
      const commit = () => {
        const nextThreshold = parse(threshold, t('panel.threshold'));
        if (nextThreshold.error !== undefined) {
          setError(nextThreshold.error);
          return;
        }
        const nextBaseline = parse(baseline, t('panel.baseline'));
        if (nextBaseline.error !== undefined) {
          setError(nextBaseline.error);
          return;
        }
        if (nextThreshold.value === null && nextBaseline.value === null) {
          setError(t('panel.needOne'));
          return;
        }
        onSave(currency, nextThreshold.value, nextBaseline.value);
        setTouched(false);
      };

      if (anchor === null || anchor === undefined) return null;
      const r = anchor.getBoundingClientRect();
      const symbol = symbolOf(currency);
      const rows = [];
      if (ready !== null) {
        rows.push(row('balance', t('tooltip.balance'), formatWallets(ready.value) || '\u2014', 'value'));
        if (bonus !== null) rows.push(row('bonus', t('tooltip.bonus'), bonus, 'bonus'));
      } else if (balance === null) {
        rows.push(row('state', t('panel.state'), t('chip.signedOut'), 'state'));
      }
      // The remaining share follows the live field, so the consequence of what
      // the user types is visible before they save.
      const cents = reading !== null ? reading.cents : ringCentsOf(balance, currency);
      const previewed = parse(baseline, t('panel.baseline'));
      const shown = previewed.value ?? (reading === null ? null : reading.baseline);
      if (shown !== null) {
        const percent = Math.max(0, Math.min(100, Math.round(cents / shown * 100)));
        rows.push(row(
          'ring',
          t('panel.remaining') + ' \u00b7 ' + currency,
          t('panel.remainingValue', {
            percent: String(percent),
            cents: formatAmount(String(cents / 100), symbol),
            baseline: formatAmount(String(shown / 100), symbol),
          }),
          reading !== null && reading.reached ? 'alert-value-alert' : 'alert-value',
        ));
      }
      if (reading !== null && reading.threshold !== null) {
        rows.push(row(
          'alert',
          t('tooltip.alerts') + ' \u00b7 ' + currency,
          formatAmount(String(reading.threshold / 100), symbol),
          reading.reached ? 'alert-value-alert' : 'alert-value',
        ));
      }
      if (touched) {
        rows.push(row('dirty-note', '', t('panel.unsaved'), 'unsaved'));
      }

      return React.createElement('div', {
        ref: panel,
        className: 'dsh-balance-editor',
        style: { left: r.right + 'px', top: (r.top - GAP) + 'px', transform: 'translate(-100%,-100%)' },
        role: 'dialog',
        'aria-label': t('panel.title'),
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        },
      }, [
        React.createElement('div', { className: 'dsh-balance-editor-title', key: 'title' }, t('panel.title')),
        React.createElement('div', { className: 'dsh-balance-editor-rows', key: 'rows' }, rows),
        React.createElement('div', { className: 'dsh-balance-editor-section', key: 'alert' }, t('alert.title')),
        React.createElement('div', { className: 'dsh-balance-editor-copy', key: 'copy' }, t('alert.description')),
        React.createElement('div', { className: 'dsh-balance-editor-field', key: 'threshold-field' }, [
          React.createElement('span', { className: 'dsh-balance-editor-field-label', key: 'label' }, t('panel.threshold')),
          React.createElement('div', { className: 'dsh-balance-editor-input-shell', key: 'shell' },
            React.createElement('input', {
              ref: input,
              className: 'dsh-balance-editor-input',
              'data-role': 'threshold',
              type: 'text',
              inputMode: 'decimal',
              value: threshold,
              placeholder: t('alert.placeholder'),
              'aria-label': t('panel.threshold'),
              'aria-invalid': String(error !== null),
              onChange: (event) => {
                setThreshold(event.target.value);
                setError(null);
                setTouched(true);
              },
            })),
        ]),
        React.createElement('div', { className: 'dsh-balance-editor-field', key: 'baseline-field' }, [
          React.createElement('span', { className: 'dsh-balance-editor-field-label', key: 'label' }, t('panel.baseline')),
          React.createElement('div', { className: 'dsh-balance-editor-input-shell', key: 'shell' }, [
            React.createElement('input', {
              key: 'input',
              className: 'dsh-balance-editor-input',
              'data-role': 'baseline',
              type: 'text',
              inputMode: 'decimal',
              value: baseline,
              placeholder: t('panel.baselinePlaceholder'),
              'aria-label': t('panel.baseline'),
              'aria-invalid': String(error !== null),
              onChange: (event) => {
                setBaseline(event.target.value);
                setError(null);
                setTouched(true);
              },
            }),
            React.createElement('button', {
              key: 'use-now',
              type: 'button',
              'data-role': 'use-now',
              className: 'dsh-balance-editor-mini',
              disabled: ready === null,
              title: t('panel.useNowHint'),
              onClick: () => {
                setBaseline(String(cents / 100));
                setError(null);
                setTouched(true);
              },
            }, t('panel.useNow')),
          ]),
        ]),
        error === null ? null : React.createElement('div', {
          className: 'dsh-balance-editor-error', key: 'error',
        }, error),
        React.createElement('div', { className: 'dsh-balance-editor-actions', key: 'actions' }, [
          React.createElement('button', {
            key: 'clear',
            type: 'button',
            'data-role': 'clear',
            className: 'dsh-balance-editor-button',
            onClick: () => {
              setThreshold('');
              setBaseline('');
              setError(null);
              setTouched(false);
              onSave(currency, null, null);
            },
          }, t('alert.clear')),
          React.createElement('button', {
            key: 'save',
            type: 'button',
            'data-role': 'save',
            className: 'dsh-balance-editor-button',
            'data-primary': 'true',
            'data-dirty': String(touched),
            onClick: commit,
          }, t('alert.save')),
        ]),
      ]);
    }

    /**
     * One label/value row of the panel's breakdown.
     * @param id - stable React key.
     * @param label - the row's left-hand label.
     * @param value - the row's right-hand value.
     * @param tone - data-tone value for the value span.
     * @returns the row element.
     */
    function row(id, label, value, tone) {
      return React.createElement('div', { className: 'dsh-balance-editor-row', key: id }, [
        React.createElement('span', { className: 'dsh-balance-editor-label', key: 'label' }, label),
        React.createElement('span', {
          className: 'dsh-balance-editor-value', key: 'value', 'data-tone': tone,
        }, value),
      ]);
    }

    /**
     * One footer row: wallet glyph, balance, and the remaining-share ring.
     * @param props - injected balance face, translated copy, and slot props.
     * @returns the chip element.
     */
    function BalanceChip({ balanceStore, refresh, t, wide }) {
      const store = balanceStore;
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const [thresholds, setThresholds] = useState(loadThresholds);
      const [baselines, setBaselines] = useState(loadBaselines);
      const [editing, setEditing] = useState(false);
      const [hovered, setHovered] = useState(false);
      const anchor = useRef(null);

      useEffect(() => {
        refresh();
      }, [refresh]);

      const balance = state.phase === 'ready' && state.balance !== undefined ? state.balance : null;

      const readings = ringReadings(balance, baselines, thresholds);
      const ring = readings.length > 0 ? readings[0] : null;
      // The panel edits one currency: the ring's, else the first wallet's, else
      // CNY as the account's default for a signed-out first run.
      const scoped = balance !== null && balance.status === 'ready'
        ? ringCurrencies(balance)
        : [];
      const currency = ring !== null ? ring.currency : (scoped[0] ?? 'CNY');

      // A click refreshes; Alt-click opens the panel, so the two actions never
      // fight over the same gesture.
      const onClick = useCallback((event) => {
        if (event.altKey) {
          setEditing(true);
          return;
        }
        refresh(true);
      }, [refresh]);

      /**
       * Apply both settings for one currency. The denominators are entirely
       * user-owned, so nothing here derives a baseline from a balance.
       * @param code - currency code being configured.
       * @param threshold - alert threshold in cents, or null to clear it.
       * @param baseline - ring denominator in cents, or null to clear it.
       */
      const applySettings = useCallback((code, threshold, baseline) => {
        setThresholds(saveThreshold(code, threshold));
        setBaselines(saveBaseline(code, baseline));
      }, []);

      const failed = state.phase === 'failed';
      let text = null;
      if (state.phase === 'ready') text = state.value ?? t('chip.empty');
      else if (state.phase === 'signed-out') text = t('chip.signedOut');
      else if (failed) text = t('chip.failed');

      const bonus = balance !== null && hasPositive(bonusWalletsOf(balance))
        ? formatWallets(bonusWalletsOf(balance))
        : null;
      const label = t('chip.label') + ': ' + (text ?? t('chip.refresh'));

      return React.createElement('div', { className: 'dsh-balance-root' }, [
        React.createElement('button', {
          key: 'chip',
          ref: anchor,
          type: 'button',
          className: 'dsh-balance-button',
          'data-wide': String(wide !== false),
          'data-failed': String(failed),
          'aria-label': label,
          'aria-live': 'polite',
          onClick,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onFocus: () => setHovered(true),
          onBlur: () => setHovered(false),
        }, [
          React.createElement(Glyph, { key: 'glyph' }),
          state.phase === 'loading'
            ? React.createElement('span', {
              key: 'value', className: 'dsh-balance-skeleton', 'aria-hidden': true,
            })
            : (wide === false ? null : React.createElement('span', {
              key: 'value', className: 'dsh-balance-value',
            }, text)),
          wide === false ? null : React.createElement(BalanceRing, { key: 'ring', reading: ring, t }),
        ]),
        // Hover keeps a one-line hint; every figure lives in the panel.
        hovered && !editing
          ? React.createElement(FixedBubble, { key: 'tip', anchor: anchor.current },
            React.createElement('span', { className: 'dsh-balance-tip-text' },
              t('tooltip.hint') + ' \u00b7 ' + t(platformIsMac() ? 'tooltip.alertHintMac' : 'tooltip.alertHint')))
          : null,
        editing
          ? React.createElement(ChipPanel, {
            key: 'panel',
            anchor: anchor.current,
            balance: state.phase === 'ready' || state.phase === 'signed-out' ? balance : null,
            bonus,
            currency,
            readings,
            onSave: applySettings,
            onClose: () => setEditing(false),
            t,
          })
          : null,
      ]);
    }

    /** Whether the host runs on macOS, whose modifier key is Option. */
    function platformIsMac() {
      const platform = globalThis.dshPlatform ?? globalThis.dshDesktop?.platform;
      if (typeof platform === 'string') return platform === 'darwin' || platform === 'macos';
      return /Mac|iPhone|iPad/.test(String(globalThis.navigator?.platform ?? ''));
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      /**
       * Register the chip and own every resource it needs.
       * @param ctx - client plugin context.
       */
      apply(ctx) {
        ensureStyles();
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-balance: dictionaries');
        const store = createBalanceStore(ctx);

        ctx.effect(() => {
          const stopStream = store.start();
          return () => {
            stopStream();
            store.dispose();
          };
        }, 'usage-balance: account store');

        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: 'usage-balance',
          order: 10,
          locale: NS,
          inject: () => ({
            balanceStore: store,
            refresh: store.refresh,
          }),
        }, BalanceChip));
      },
    };
  },
});
