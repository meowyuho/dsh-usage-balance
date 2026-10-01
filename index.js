/**
 * Host half of the usage-balance bundle.
 *
 * The balance itself is read in the browser through the account Remote
 * namespace (`account.getBalance`), so this half contributes no Host service.
 * It exists so the bundle owns a Loader row, which is what makes the browser
 * half discoverable: `dsh-client-modules` scans enabled Loader entries and
 * serves each `dsh.client` declaration as a bundle.
 *
 * @returns nothing; the Client module owns the rendering.
 */
export function apply() {}
